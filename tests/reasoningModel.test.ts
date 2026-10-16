import { describe, expect, it, vi } from 'vitest'
import { parseOpenAILine, parseOpenAIUsage } from '../src/shared/sse'

/**
 * 推理模型（deepseek-reasoner、o 系列等）的处理。
 *
 * 用户反馈"测试连接显示成功但没内容"。根因是：推理模型会先用掉一大截
 * 输出预算做思考，给 5 个 token 时正式回答一个字都出不来。
 * 这些测试锁住"能识别出这种情况并给出准确提示"。
 */

vi.mock('electron', () => ({
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  app: { getPath: () => 'C:\\测试目录', isPackaged: false }
}))

const { runChat, testConnection } = await import('../src/main/llm/client')
type ModelProfile = import('../src/main/profiles').ModelProfile

function profile(baseUrl: string, over: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'test',
    name: '测试',
    format: 'openai',
    baseUrl,
    model: 'deepseek-reasoner',
    temperature: 0.3,
    maxTokens: 4096,
    timeoutMs: 10000,
    privacyNoticeShown: true,
    ...over
  }
}

/** 假服务商：模拟推理模型的行为 */
async function startReasoningServer(options: {
  /** 正式回答的内容，空字符串表示被推理占满 */
  content: string
  /** 推理内容 */
  reasoning?: string
  /** 服务商返回的结束原因 */
  finishReason?: string
}): Promise<{ url: string; close: () => Promise<void>; lastBody: () => unknown }> {
  const { createServer } = await import('http')
  let lastBody: unknown = null

  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}')
      lastBody = body

      res.writeHead(200, { 'content-type': 'application/json', connection: 'close' })
      res.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: options.content,
                ...(options.reasoning ? { reasoning_content: options.reasoning } : {})
              },
              finish_reason: options.finishReason ?? 'stop'
            }
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 100,
            completion_tokens_details: { reasoning_tokens: 90 }
          }
        })
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    lastBody: () => lastBody,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

describe('测试连接：推理模型的 max_tokens 不能太小', () => {
  it('给推理模型留足输出预算（不能是 5）', async () => {
    const server = await startReasoningServer({ content: '好' })
    try {
      await testConnection(profile(server.url), 'k')
      const body = server.lastBody() as Record<string, unknown>
      // 5 个 token 会被推理吃光，必须给足
      expect(body.max_tokens as number).toBeGreaterThanOrEqual(256)
    } finally {
      await server.close()
    }
  })

  it('推理占满预算、正文为空时，提示指向推理模型而不是"检查模型名"', async () => {
    const server = await startReasoningServer({
      content: '',
      reasoning: '让我想想……用户想要我回复一个字……',
      finishReason: 'length'
    })

    try {
      const result = await testConnection(profile(server.url), 'k')
      expect(result.ok).toBe(false)
      if (!result.ok) {
        // 关键：不能再说"检查模型名是否正确"，那会误导用户
        expect(result.error.message).toContain('推理')
        expect(result.error.suggestion).toContain('deepseek-chat')
      }
    } finally {
      await server.close()
    }
  })

  it('模型正常返回内容时测试成功', async () => {
    const server = await startReasoningServer({ content: '好' })
    try {
      const result = await testConnection(profile(server.url), 'k')
      expect(result.ok).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('连接成功时告知这个模型带推理过程', async () => {
    const server = await startReasoningServer({ content: '好', reasoning: '思考中' })
    try {
      const result = await testConnection(profile(server.url), 'k')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.sawReasoning).toBe(true)
      }
    } finally {
      await server.close()
    }
  })

  it('普通模型不会被误报成推理模型', async () => {
    const server = await startReasoningServer({ content: '好' })
    try {
      const result = await testConnection(profile(server.url), 'k')
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.sawReasoning).toBe(false)
      }
    } finally {
      await server.close()
    }
  })
})

describe('非流式响应：推理内容不进正文', () => {
  it('同时有 content 和 reasoning_content 时只取 content', async () => {
    const server = await startReasoningServer({
      content: '最终答案',
      reasoning: '这是思考过程，不该出现在结果里'
    })

    try {
      const result = await runChat({
        profile: profile(server.url),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 100
      })

      expect(result.text).toBe('最终答案')
      expect(result.text).not.toContain('思考过程')
    } finally {
      await server.close()
    }
  })
})

describe('流式：推理模型的行为', () => {
  it('reasoning_content 不会混进正文', () => {
    const reasoning = parseOpenAILine(
      JSON.stringify({ choices: [{ delta: { reasoning_content: '思考中' } }] })
    )
    expect(reasoning?.text).toBe('')
    expect(reasoning?.reasoning).toBe(true)

    const answer = parseOpenAILine(
      JSON.stringify({ choices: [{ delta: { content: '答案' } }] })
    )
    expect(answer?.text).toBe('答案')
  })

  it('推理模型的用量也能读到（含 reasoning_tokens 时不影响）', () => {
    const usage = parseOpenAIUsage({
      usage: {
        prompt_tokens: 10,
        completion_tokens: 100,
        completion_tokens_details: { reasoning_tokens: 90 }
      }
    })
    expect(usage).toEqual({ input: 10, output: 100, cached: 0 })
  })
})
