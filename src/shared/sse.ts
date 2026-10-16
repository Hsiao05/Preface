/**
 * SSE（Server-Sent Events）流的解析。
 *
 * 两种 API 格式都返回 SSE，但事件结构不同：
 * - OpenAI 兼容：choices[0].delta.content
 * - Anthropic：content_block_delta 事件里的 text_delta
 *
 * 两种格式都必须忽略"思考内容"：
 * - OpenAI 兼容服务可能返回 reasoning_content 字段
 * - Anthropic 可能返回 thinking 类型的 content_block
 */

export interface StreamDelta {
  /** 正文增量 */
  text: string
  /** 这次增量是不是思考内容（用于提示用户） */
  reasoning: boolean
  /**
   * 这一块里的结束原因。只有最后一个块才有。
   * OpenAI 兼容格式的 finish_reason 为 'length' 表示被输出上限截断。
   */
  finishReason?: string
}

export interface UsageInfo {
  input: number
  output: number
  cached: number
}

/** 解析一行 SSE 数据。返回 null 表示这行没有可用内容。 */
export function parseOpenAILine(data: string): StreamDelta | null {
  if (!data || data === '[DONE]') return null

  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }

  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>

  const choices = obj.choices
  if (!Array.isArray(choices) || choices.length === 0) return null

  const choice = choices[0] as Record<string, unknown>
  const delta = choice.delta
  if (typeof delta !== 'object' || delta === null) return null

  const d = delta as Record<string, unknown>

  // finish_reason 只在最后一个块里出现，'length' 表示被输出上限截断
  const finishReason =
    typeof choice.finish_reason === 'string' ? choice.finish_reason : undefined

  // 思考内容：不能取，但要记下来提示用户
  const reasoning = typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0
  if (reasoning) {
    return { text: '', reasoning: true, finishReason }
  }

  const content = d.content
  if (typeof content === 'string' && content.length > 0) {
    return { text: content, reasoning: false, finishReason }
  }

  // 内容为空但带了结束原因时，也要把这个信息传出去
  if (finishReason) {
    return { text: '', reasoning: false, finishReason }
  }

  return null
}

/** 从 OpenAI 兼容的响应里读用量 */
export function parseOpenAIUsage(obj: Record<string, unknown>): UsageInfo | null {
  const usage = obj.usage
  if (typeof usage !== 'object' || usage === null) return null
  const u = usage as Record<string, unknown>

  const input = typeof u.prompt_tokens === 'number' ? u.prompt_tokens : 0
  const output = typeof u.completion_tokens === 'number' ? u.completion_tokens : 0

  let cached = 0
  const details = u.prompt_tokens_details
  if (typeof details === 'object' && details !== null) {
    const d = details as Record<string, unknown>
    if (typeof d.cached_tokens === 'number') cached = d.cached_tokens
  }

  if (input === 0 && output === 0) return null
  return { input, output, cached }
}

export interface AnthropicEvent {
  delta?: StreamDelta
  usage?: Partial<UsageInfo>
}

/** 解析一行 Anthropic SSE 数据 */
export function parseAnthropicLine(data: string): AnthropicEvent | null {
  if (!data) return null

  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return null
  }

  if (typeof json !== 'object' || json === null) return null
  const obj = json as Record<string, unknown>
  const type = obj.type

  // message_start：带 input_tokens
  if (type === 'message_start') {
    const message = obj.message
    if (typeof message === 'object' && message !== null) {
      const m = message as Record<string, unknown>
      const usage = m.usage
      if (typeof usage === 'object' && usage !== null) {
        const u = usage as Record<string, unknown>
        const result: Partial<UsageInfo> = {}
        if (typeof u.input_tokens === 'number') result.input = u.input_tokens
        if (typeof u.cache_read_input_tokens === 'number') {
          result.cached = u.cache_read_input_tokens
        }
        return { usage: result }
      }
    }
    return null
  }

  // message_delta：带 output_tokens 和 stop_reason
  if (type === 'message_delta') {
    const result: AnthropicEvent = {}

    const usage = obj.usage
    if (typeof usage === 'object' && usage !== null) {
      const u = usage as Record<string, unknown>
      if (typeof u.output_tokens === 'number') {
        result.usage = { output: u.output_tokens }
      }
    }

    // stop_reason 为 'max_tokens' 表示被输出上限截断
    if (typeof obj.delta === 'object' && obj.delta !== null) {
      const d = obj.delta as Record<string, unknown>
      if (typeof d.stop_reason === 'string') {
        result.delta = {
          text: '',
          reasoning: false,
          finishReason: d.stop_reason === 'max_tokens' ? 'length' : d.stop_reason
        }
      }
    }

    return Object.keys(result).length > 0 ? result : null
  }

  // content_block_start：thinking 类型的块，忽略
  if (type === 'content_block_start') {
    const block = obj.content_block
    if (typeof block === 'object' && block !== null) {
      const b = block as Record<string, unknown>
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        return { delta: { text: '', reasoning: true } }
      }
    }
    return null
  }

  // content_block_delta：正文
  if (type === 'content_block_delta') {
    const delta = obj.delta
    if (typeof delta === 'object' && delta !== null) {
      const d = delta as Record<string, unknown>

      // thinking_delta 是思考内容
      if (d.type === 'thinking_delta') {
        return { delta: { text: '', reasoning: true } }
      }

      if (d.type === 'text_delta' && typeof d.text === 'string') {
        return { delta: { text: d.text, reasoning: false } }
      }
    }
    return null
  }

  return null
}

/**
 * 按行切分 SSE 数据流。
 *
 * SSE 以空行分隔事件，每行形如 "data: {...}"。
 * 网络分片可能把一个事件切成多段，所以要用缓冲区累积。
 */
export class SseBuffer {
  private buffer = ''

  /** 喂入一段数据，返回本次能完整解析出的所有 data 行 */
  push(chunk: string): string[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    // 最后一段可能不完整，留在缓冲区里
    this.buffer = lines.pop() ?? ''

    const dataLines: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data) dataLines.push(data)
    }
    return dataLines
  }

  /** 流结束时把缓冲区里剩下的内容也解析掉 */
  flush(): string[] {
    const rest = this.buffer.trim()
    this.buffer = ''
    if (!rest.startsWith('data:')) return []
    const data = rest.slice(5).trim()
    return data ? [data] : []
  }
}
