import { log } from '../logger'
import { httpFetch } from '../http'

// 保持向后兼容：原来这个文件导出的 setFetchForTesting 现在转发到 http 模块
export { setFetchForTesting } from '../http'
import { chatEndpoint, modelsEndpoint, suggestV1Retry, type ApiFormat } from '../../shared/normalize'
import {
  parseAnthropicLine,
  parseOpenAILine,
  parseOpenAIUsage,
  SseBuffer,
  type UsageInfo
} from '../../shared/sse'
import { describeHttpError, describeNetworkError, type LlmError } from '../../shared/llmErrors'
import { saveProfile, type ModelProfile } from '../profiles'

/**
 * 模型调用。
 *
 * 【硬性要求】
 * - 所有请求只能从主进程发出（界面进程会碰到 CORS 问题，而且 Key 不该出现在那里）
 * - 用 Electron 的 net 模块而不是 Node 的 https，这样会自动使用用户的系统代理
 * - 每次调用都可以取消（AbortController）
 * - 忽略所有"思考内容"，只取正文
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface RunOptions {
  profile: ModelProfile
  apiKey: string
  messages: ChatMessage[]
  stream: boolean
  maxTokens: number
  temperature?: number
  /** 收到正文增量时调用 */
  onDelta?: (text: string) => void
  /** 发现模型带推理过程时调用一次 */
  onReasoning?: () => void
  /** 收到用量时调用 */
  onUsage?: (usage: UsageInfo) => void
  signal?: AbortSignal
}

export interface RunResult {
  text: string
  usage: UsageInfo | null
  /** 模型带了推理过程 */
  sawReasoning: boolean
  /**
   * 输出被截断了（达到 max_tokens 上限）。
   *
   * OpenAI 兼容格式的 finish_reason 会是 'length'，
   * Anthropic 的 stop_reason 会是 'max_tokens'。
   */
  truncated: boolean
  /**
   * 推理过程本身用掉的 token 数（服务商提供时才有）。
   * 用来判断"预算是不是被思考吃掉了"。
   */
  reasoningTokens: number
}

export class LlmRequestError extends Error {
  readonly info: LlmError

  constructor(info: LlmError) {
    super(info.message)
    this.name = 'LlmRequestError'
    this.info = info
  }
}

/** 发一次对话请求 */
export async function runChat(options: RunOptions): Promise<RunResult> {
  const { profile, apiKey, messages, stream, signal } = options

  const attempt = async (baseUrl: string): Promise<RunResult> =>
    performChat({ ...options, profile: { ...profile, baseUrl } }, apiKey, messages, stream, signal)

  try {
    return await attempt(profile.baseUrl)
  } catch (error) {
    // OpenAI 格式收到 404，且地址里没有 /v1 时，补上重试一次
    if (
      error instanceof LlmRequestError &&
      error.info.status === 404 &&
      profile.format === 'openai'
    ) {
      const retry = suggestV1Retry(profile.baseUrl, profile.format)
      if (retry.changed) {
        log(`收到 404，自动补全为 ${retry.url} 后重试`)
        const result = await attempt(retry.url)
        // 重试成功后把补全后的地址写回配置
        saveProfile({ ...profile, baseUrl: retry.url })
        return result
      }
    }
    throw error
  }
}

async function performChat(
  options: RunOptions,
  apiKey: string,
  messages: ChatMessage[],
  stream: boolean,
  signal?: AbortSignal
): Promise<RunResult> {
  const { profile, onDelta, onReasoning, onUsage } = options
  const url = chatEndpoint(profile.baseUrl, profile.format)
  const body = buildRequestBody(profile, messages, stream, options)

  const handle = await sendRequest({
    url,
    format: profile.format,
    apiKey,
    body,
    timeoutMs: profile.timeoutMs,
    signal
  })
  const { response } = handle

  // 注意：cleanup 要在整段流读完（或出错）之后才调用，
  // 否则流式过程中的取消会失效。
  try {
    if (!response.ok) {
      const text = await safeReadText(response)
      throw new LlmRequestError(describeHttpError(response.status, text))
    }

    if (!stream) {
      return parseNonStreamResponse(await response.json(), profile.format)
    }

    return await parseStream(response, profile.format, { onDelta, onReasoning, onUsage })
  } catch (error) {
    // 流读到一半被取消或超时，给出对应的中文提示
    if (signal?.aborted) {
      throw new LlmRequestError({ message: '请求已取消' })
    }
    if (handle.didTimeout()) {
      throw new LlmRequestError({
        message: '请求超时',
        suggestion: '服务商响应太慢。可以稍后再试，或在设置里把超时时间调长。'
      })
    }
    throw error
  } finally {
    handle.cleanup()
  }
}

/** 组装请求体。两种格式的字段名不同。 */
function buildRequestBody(
  profile: ModelProfile,
  messages: ChatMessage[],
  stream: boolean,
  options: RunOptions
): Record<string, unknown> {
  const maxTokens = options.maxTokens
  const temperature = options.temperature ?? profile.temperature

  if (profile.format === 'openai') {
    return {
      model: profile.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream
      // 不发送任何与推理相关的参数
    }
  }

  // Anthropic：system 单独一个字段，messages 只放 user 和 assistant
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content)
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))

  const body: Record<string, unknown> = {
    model: profile.model,
    max_tokens: maxTokens,
    temperature,
    messages: rest,
    stream
    // 不发送 thinking 参数
  }

  if (systemParts.length > 0) {
    body.system = systemParts.join('\n\n')
  }

  return body
}

interface SendRequestInput {
  url: string
  format: ApiFormat
  apiKey: string
  body: Record<string, unknown>
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * 一次请求的取消/超时控制。
 *
 * 【为什么要把清理和请求分开】
 * 请求发出后拿到响应头只是开始，流式内容还要读很久。
 * 如果在拿到响应头时就解绑外部的取消信号，用户在流式过程中点取消就没用了
 * —— 请求会继续跑完，界面还以为取消成功了。
 * 所以把 controller 和清理函数一起交出去，由调用方在流真正读完后再清理。
 */
interface RequestHandle {
  response: Response
  /** 流读完后必须调用，解绑信号并清掉超时计时器 */
  cleanup: () => void
  /** 是否是因为超时而中止 */
  didTimeout: () => boolean
}

/** 用 Electron 的 net 模块发请求，自动走系统代理 */
async function sendRequest(input: SendRequestInput): Promise<RequestHandle> {
  const { url, format, apiKey, body, timeoutMs, signal } = input

  // 调用前就已经被取消（例如用户连点了两次取消），直接返回
  if (signal?.aborted) {
    throw new LlmRequestError({ message: '请求已取消' })
  }

  const controller = new AbortController()

  // 外部取消信号要能传到内部，并且一直保持到流读完
  const onAbort = (): void => controller.abort()
  signal?.addEventListener('abort', onAbort)

  const cleanup = (): void => {
    clearTimeout(timeoutTimer)
    signal?.removeEventListener('abort', onAbort)
  }

  const headers: Record<string, string> = {
    'content-type': 'application/json'
  }

  if (format === 'openai') {
    headers['authorization'] = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  }

  // 区分"用户取消"和"超时"：两者都会 abort，但提示语完全不同
  let timedOut = false
  const timeoutTimer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await httpFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    })
    return { response, cleanup, didTimeout: () => timedOut }
  } catch (error) {
    cleanup()
    // 用户主动取消时，给出明确的错误而不是网络错误
    if (signal?.aborted) {
      throw new LlmRequestError({ message: '请求已取消' })
    }
    if (timedOut) {
      throw new LlmRequestError({
        message: '请求超时',
        suggestion: '服务商响应太慢。可以稍后再试，或在设置里把超时时间调长。'
      })
    }
    throw new LlmRequestError(describeNetworkError(error))
  }
}

/** 非流式响应 */
function parseNonStreamResponse(json: unknown, format: ApiFormat): RunResult {
  const obj = (json ?? {}) as Record<string, unknown>

  if (format === 'openai') {
    const choices = obj.choices
    if (Array.isArray(choices) && choices.length > 0) {
      const choice = choices[0] as Record<string, unknown>
      const message = choice.message as Record<string, unknown> | undefined
      const text = typeof message?.content === 'string' ? message.content : ''

      // 推理模型会在 message 里多一个 reasoning_content。
      // 它的内容不能进正文，但要记下来，好在正文为空时给用户准确提示。
      const sawReasoning =
        typeof message?.reasoning_content === 'string' && message.reasoning_content.length > 0

      return {
        text,
        usage: parseOpenAIUsage(obj),
        sawReasoning,
        truncated: choice.finish_reason === 'length',
        reasoningTokens: readReasoningTokens(obj)
      }
    }
    return emptyResult()
  }

  // Anthropic：content 是内容块数组，只取 text 类型的
  const content = obj.content
  if (Array.isArray(content)) {
    let text = ''
    let sawReasoning = false
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') {
        text += b.text
      } else if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        sawReasoning = true
      }
    }
    const usage = obj.usage
    let parsedUsage: UsageInfo | null = null
    if (typeof usage === 'object' && usage !== null) {
      const u = usage as Record<string, unknown>
      parsedUsage = {
        input: typeof u.input_tokens === 'number' ? u.input_tokens : 0,
        output: typeof u.output_tokens === 'number' ? u.output_tokens : 0,
        cached: typeof u.cache_read_input_tokens === 'number' ? u.cache_read_input_tokens : 0
      }
    }
    return {
      text,
      usage: parsedUsage,
      sawReasoning,
      truncated: obj.stop_reason === 'max_tokens',
      reasoningTokens: 0
    }
  }

  return emptyResult()
}

/** 空结果。各字段都给安全的默认值。 */
function emptyResult(): RunResult {
  return { text: '', usage: null, sawReasoning: false, truncated: false, reasoningTokens: 0 }
}

/** 从 OpenAI 兼容响应里读推理 token 数 */
function readReasoningTokens(obj: Record<string, unknown>): number {
  const usage = obj.usage
  if (typeof usage !== 'object' || usage === null) return 0
  const details = (usage as Record<string, unknown>).completion_tokens_details
  if (typeof details !== 'object' || details === null) return 0
  const value = (details as Record<string, unknown>).reasoning_tokens
  return typeof value === 'number' ? value : 0
}

interface StreamCallbacks {
  onDelta?: (text: string) => void
  onReasoning?: () => void
  onUsage?: (usage: UsageInfo) => void
}

/** 解析 SSE 流 */
async function parseStream(
  response: Response,
  format: ApiFormat,
  callbacks: StreamCallbacks
): Promise<RunResult> {
  const body = response.body
  if (!body) {
    throw new LlmRequestError({ message: '服务商没有返回内容' })
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const buffer = new SseBuffer()

  let text = ''
  let sawReasoning = false
  let reasoningNotified = false
  let truncated = false
  const usage: UsageInfo = { input: 0, output: 0, cached: 0 }
  let sawUsage = false

  const handleData = (data: string): void => {
    if (format === 'openai') {
      const delta = parseOpenAILine(data)
      if (!delta) {
        // 可能这一行带了用量
        try {
          const obj = JSON.parse(data)
          const u = parseOpenAIUsage(obj)
          if (u) {
            usage.input = u.input
            usage.output = u.output
            usage.cached = u.cached
            sawUsage = true
            callbacks.onUsage?.(usage)
          }
        } catch {
          // 忽略解析不了的
        }
        return
      }

      // 结束原因：'length' 表示被输出上限截断
      if (delta.finishReason === 'length') truncated = true

      if (delta.reasoning) {
        sawReasoning = true
        if (!reasoningNotified) {
          reasoningNotified = true
          callbacks.onReasoning?.()
        }
        return
      }

      if (delta.text) {
        text += delta.text
        callbacks.onDelta?.(delta.text)
      }
      return
    }

    // Anthropic
    const event = parseAnthropicLine(data)
    if (!event) return

    if (event.delta) {
      if (event.delta.finishReason === 'length') truncated = true

      if (event.delta.reasoning) {
        sawReasoning = true
        if (!reasoningNotified) {
          reasoningNotified = true
          callbacks.onReasoning?.()
        }
        return
      }
      if (event.delta.text) {
        text += event.delta.text
        callbacks.onDelta?.(event.delta.text)
      }
    }

    if (event.usage) {
      if (event.usage.input !== undefined) usage.input = event.usage.input
      if (event.usage.output !== undefined) usage.output = event.usage.output
      if (event.usage.cached !== undefined) usage.cached = event.usage.cached
      sawUsage = true
      callbacks.onUsage?.(usage)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      for (const line of buffer.push(chunk)) handleData(line)
    }
    for (const line of buffer.flush()) handleData(line)
  } catch (error) {
    // 主动中止（用户取消或超时）时不能当成功处理，
    // 否则界面会以为整理完成了，把半截结果写回去。
    if (isAbortError(error)) {
      throw error
    }

    // 网络意外中断时，已经收到的部分不丢掉
    if (text) {
      log(`流式读取中断，但已收到 ${text.length} 字，保留这部分`)
      return { text, usage: sawUsage ? usage : null, sawReasoning, truncated, reasoningTokens: 0 }
    }
    throw new LlmRequestError(describeNetworkError(error))
  } finally {
    reader.releaseLock()
  }

  return { text, usage: sawUsage ? usage : null, sawReasoning, truncated, reasoningTokens: 0 }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

/** 判断是不是"主动中止"造成的错误（用户取消或超时） */
function isAbortError(error: unknown): boolean {
  if (error instanceof LlmRequestError) return true
  if (error instanceof Error) {
    const name = error.name.toLowerCase()
    const message = error.message.toLowerCase()
    return (
      name === 'aborterror' ||
      message.includes('aborted') ||
      message.includes('abort') ||
      message.includes('canceled') ||
      message.includes('cancelled')
    )
  }
  return false
}

// ---------- 模型列表 ----------

export interface ModelInfo {
  id: string
  displayName?: string
}

/** 获取模型列表 */
export async function listModels(profile: ModelProfile, apiKey: string): Promise<ModelInfo[]> {
  const url = modelsEndpoint(profile.baseUrl, profile.format)

  const headers: Record<string, string> = {}
  if (profile.format === 'openai') {
    headers['authorization'] = `Bearer ${apiKey}`
  } else {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'
  }

  const models: ModelInfo[] = []
  let nextUrl: string | null = url
  let pages = 0

  // Anthropic 可能分页，最多取 20 页防止死循环
  while (nextUrl && pages < 20) {
    pages++

    let response: Response
    try {
      response = await httpFetch(nextUrl, { headers })
    } catch (error) {
      throw new LlmRequestError(describeNetworkError(error))
    }

    if (!response.ok) {
      const text = await safeReadText(response)
      throw new LlmRequestError(describeHttpError(response.status, text))
    }

    const json = (await response.json()) as Record<string, unknown>
    const data = json.data

    if (Array.isArray(data)) {
      for (const item of data) {
        if (typeof item !== 'object' || item === null) continue
        const m = item as Record<string, unknown>
        if (typeof m.id === 'string') {
          models.push({
            id: m.id,
            displayName: typeof m.display_name === 'string' ? m.display_name : undefined
          })
        }
      }
    }

    // 分页：Anthropic 返回 has_more 和 last_id
    if (json.has_more === true && typeof json.last_id === 'string') {
      nextUrl = `${url}?after_id=${encodeURIComponent(json.last_id)}`
    } else {
      nextUrl = null
    }
  }

  // 按名称排序
  models.sort((a, b) => a.id.localeCompare(b.id))
  return models
}

/**
 * 测试连接：发一个极短的请求。
 *
 * 【为什么 max_tokens 不能太小】
 * 文档说"限制最多输出 5 个字"，但推理模型（deepseek-reasoner、o 系列等）
 * 会先用掉一大截预算做推理。给 5 个 token 时，推理就把预算用光了，
 * 正式回答一个字都出不来，于是"连接成功但没内容"。
 * 所以这里给足 512，同时在正文为空时给出针对性的提示。
 */
export async function testConnection(
  profile: ModelProfile,
  apiKey: string
): Promise<{ ok: true; elapsedMs: number; sawReasoning: boolean } | { ok: false; error: LlmError }> {
  const started = Date.now()

  try {
    const result = await runChat({
      profile,
      apiKey,
      messages: [{ role: 'user', content: '回复"好"这一个字，不要输出别的。' }],
      stream: false,
      maxTokens: 512,
      temperature: 0
    })

    if (!result.text.trim()) {
      // 区分两种情况：推理吃掉了全部预算，还是真的什么都没返回
      if (result.sawReasoning) {
        return {
          ok: false,
          error: {
            message: '连接成功，但这是个推理模型，本次回答被推理过程占满了',
            suggestion:
              '模型本身可用。建议换一个非推理模型（例如 deepseek-chat），响应更快也更省。'
          }
        }
      }
      return {
        ok: false,
        error: {
          message: '连接成功，但模型没有返回内容',
          suggestion: '请检查模型名是否正确，或换一个模型试试。'
        }
      }
    }

    return { ok: true, elapsedMs: Date.now() - started, sawReasoning: result.sawReasoning }
  } catch (error) {
    if (error instanceof LlmRequestError) {
      return { ok: false, error: error.info }
    }
    return { ok: false, error: describeNetworkError(error) }
  }
}
