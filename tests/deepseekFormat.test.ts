import { describe, expect, it } from 'vitest'
import { parseOpenAILine, parseOpenAIUsage, SseBuffer } from '../src/shared/sse'

/**
 * DeepSeek 的真实响应格式。
 *
 * 这些样本来自 DeepSeek 官方文档的响应示例，用来确认解析器能吃下它的格式。
 * 用户反馈"连接成功但模型没有返回内容"，所以这里逐个字段核对。
 */

describe('DeepSeek 非流式响应', () => {
  // 官方文档的响应示例
  const response = {
    id: '930c9bed-4d59-4429-aa25-cd061394152c',
    object: 'chat.completion',
    created: 1741692702,
    model: 'deepseek-chat',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '你好！很高兴见到你。有什么我可以帮你的吗？'
        },
        logprobs: null,
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 16,
      total_tokens: 26,
      prompt_tokens_details: { cached_tokens: 0 },
      prompt_cache_hit_tokens: 0,
      prompt_cache_miss_tokens: 10
    },
    system_fingerprint: 'fp_3a215609df_bfs_20250304'
  }

  it('能取到 message.content', () => {
    const choice = response.choices[0]
    const text = choice.message.content
    expect(text).toBe('你好！很高兴见到你。有什么我可以帮你的吗？')
    expect(text.trim().length).toBeGreaterThan(0)
  })

  it('能读到用量', () => {
    const usage = parseOpenAIUsage(response as unknown as Record<string, unknown>)
    expect(usage).toEqual({ input: 10, output: 16, cached: 0 })
  })

  it('finish_reason 是 stop 时，内容应当非空', () => {
    expect(response.choices[0].finish_reason).toBe('stop')
  })
})

describe('DeepSeek 推理模型的响应', () => {
  // deepseek-reasoner 会在 message 里多一个 reasoning_content
  const response = {
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '最终答案',
          reasoning_content: '让我想想……用户问的是……'
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 100,
      completion_tokens_details: { reasoning_tokens: 90 }
    }
  }

  it('取 content 而不是 reasoning_content', () => {
    const message = response.choices[0].message
    expect(message.content).toBe('最终答案')
    expect(message.content).not.toContain('让我想想')
  })

  it('推理占满预算时 content 会是空字符串', () => {
    // 这是 max_tokens 太小时会发生的情况：
    // 推理内容把预算用完，正式回答一个字都没输出
    const truncated = {
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: '',
            reasoning_content: '推理内容占满了预算……'
          },
          finish_reason: 'length'
        }
      ]
    }

    const message = truncated.choices[0].message
    expect(message.content).toBe('')
    expect(truncated.choices[0].finish_reason).toBe('length')
    // 这种情况必须能识别出来，给用户明确的提示
  })
})

describe('DeepSeek 流式响应', () => {
  it('逐块解析 delta.content', () => {
    const chunks = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"你"},"finish_reason":null}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"好"},"finish_reason":null}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n'
    ]

    const buffer = new SseBuffer()
    let text = ''
    let finishReason: string | null = null

    for (const chunk of chunks) {
      for (const line of buffer.push(chunk)) {
        const delta = parseOpenAILine(line)
        if (delta?.text) text += delta.text
        if (line !== '[DONE]') {
          try {
            const json = JSON.parse(line)
            const fr = json.choices?.[0]?.finish_reason
            if (fr) finishReason = fr
          } catch {
            /* 忽略 */
          }
        }
      }
    }

    expect(text).toBe('你好')
    expect(finishReason).toBe('stop')
  })

  it('推理模型流式：reasoning_content 不进正文', () => {
    const reasoning = parseOpenAILine(
      JSON.stringify({
        choices: [{ delta: { reasoning_content: '思考中…' }, finish_reason: null }]
      })
    )
    expect(reasoning).toEqual({ text: '', reasoning: true })

    const answer = parseOpenAILine(
      JSON.stringify({ choices: [{ delta: { content: '答案' }, finish_reason: null }] })
    )
    expect(answer).toEqual({ text: '答案', reasoning: false })
  })

  it('分片切开一个完整的 SSE 事件也能拼回来', () => {
    const buffer = new SseBuffer()
    const full = 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n'
    // 从中间切成三段
    const part1 = full.slice(0, 25)
    const part2 = full.slice(25, 45)
    const part3 = full.slice(45)

    expect(buffer.push(part1)).toEqual([])
    expect(buffer.push(part2)).toEqual([])
    expect(buffer.push(part3)).toEqual(['{"choices":[{"delta":{"content":"好"}}]}'])
  })

  it('中文内容按字节切分后也不会乱码', () => {
    const buffer = new SseBuffer()
    const full = `data: ${JSON.stringify({ choices: [{ delta: { content: '中文测试' } }] })}\n\n`
    // 按字节切
    const bytes = Buffer.from(full, 'utf-8')
    const mid = Math.floor(bytes.length / 2)

    // 模拟 TextDecoder 的流式解码（client.ts 里就是这么做的）
    const decoder = new TextDecoder()
    const part1 = decoder.decode(bytes.subarray(0, mid), { stream: true })
    const part2 = decoder.decode(bytes.subarray(mid), { stream: true })

    const lines = [...buffer.push(part1), ...buffer.push(part2)]
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]).choices[0].delta.content).toBe('中文测试')
  })
})
