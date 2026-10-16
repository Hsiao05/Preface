import { describe, expect, it, vi, beforeEach } from 'vitest'
import { SseBuffer } from '../src/shared/sse'

/**
 * 这两个测试针对用户实际遇到的两个 bug：
 *
 * 1. 点取消之后请求还在后台跑，过一会儿又提示"整理完成"
 *    —— 根因：拿到响应头之后就把取消信号解绑了，流式读取阶段取消无效。
 *
 * 2. 整理完的内容不显示，原文还被清空了
 *    —— 根因有两个：事件监听器注册得比主进程发事件晚（漏掉内容），
 *       以及结束回调拿到空内容时仍然覆盖了原文。
 *
 * 下面用假服务商 + 可注入的 fetch 复现这两条路径。
 */

vi.mock('electron', () => {
  const fetchWithRetry = async (url: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetch(url, init)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const isConnectionError =
        message.includes('fetch failed') ||
        message.includes('ECONNRESET') ||
        message.includes('ECONNREFUSED') ||
        message.includes('socket hang up')
      if (!isConnectionError || init?.signal?.aborted) throw error
      await new Promise((resolve) => setTimeout(resolve, 20))
      return fetch(url, init)
    }
  }
  return {
    net: { fetch: fetchWithRetry },
    app: { getPath: () => 'C:\\测试目录', isPackaged: false }
  }
})

const { runChat } = await import('../src/main/llm/client')
type ModelProfile = import('../src/main/profiles').ModelProfile

function profile(baseUrl: string, over: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'test',
    name: '测试',
    format: 'openai',
    baseUrl,
    model: 'test-model',
    temperature: 0.3,
    maxTokens: 4096,
    timeoutMs: 10000,
    privacyNoticeShown: true,
    ...over
  }
}

/**
 * 一个慢速的假服务商：先返回响应头，然后每隔一段时间吐一个字。
 * 这样才能在"流式进行中"这个时间窗里测试取消。
 */
async function startSlowServer(options: {
  chars: string[]
  intervalMs: number
}): Promise<{ url: string; close: () => Promise<void>; sentCount: () => number }> {
  const { createServer } = await import('http')
  let sent = 0

  const server = createServer((req, res) => {
    req.on('data', () => {})
    req.on('end', () => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'close'
      })

      let index = 0
      const timer = setInterval(() => {
        if (index >= options.chars.length) {
          clearInterval(timer)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }
        const char = options.chars[index++]
        sent++
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: char } }] })}\n\n`)
      }, options.intervalMs)

      res.on('close', () => clearInterval(timer))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0

  return {
    url: `http://127.0.0.1:${port}`,
    sentCount: () => sent,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      })
  }
}

describe('流式进行中取消（回归测试）', () => {
  it('取消之后请求真的停下来，不再继续收内容', async () => {
    // 100 个字，每个间隔 30ms，总共要 3 秒
    const chars = Array.from({ length: 100 }, (_, i) => String(i % 10))
    const server = await startSlowServer({ chars, intervalMs: 30 })

    const controller = new AbortController()
    const received: string[] = []

    const promise = runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      signal: controller.signal,
      onDelta: (t) => received.push(t)
    })

    // 等收到几个字之后再取消，确保是在"流式进行中"
    await new Promise((resolve) => setTimeout(resolve, 150))
    const beforeCancel = received.length
    expect(beforeCancel).toBeGreaterThan(0)

    controller.abort()

    // 必须抛出"请求已取消"，而不是正常返回
    await expect(promise).rejects.toMatchObject({
      info: { message: '请求已取消' }
    })

    // 取消之后再等一会儿，不应该再收到新内容
    const afterCancel = received.length
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(received.length).toBe(afterCancel)

    await server.close()
  })

  it('取消时不会把半截内容当成成功结果返回', async () => {
    const server = await startSlowServer({ chars: ['甲', '乙', '丙', '丁', '戊'], intervalMs: 40 })

    const controller = new AbortController()
    const promise = runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      signal: controller.signal
    })

    await new Promise((resolve) => setTimeout(resolve, 100))
    controller.abort()

    // 关键：必须是 reject，不能 resolve 出半截文本。
    // 否则界面会以为整理完成了，把半截结果写回原文。
    await expect(promise).rejects.toMatchObject({
      info: { message: '请求已取消' }
    })

    await server.close()
  })

  it('正常读完的流仍然返回完整内容（取消逻辑没影响正常路径）', async () => {
    const server = await startSlowServer({ chars: ['你', '好', '世', '界'], intervalMs: 10 })

    const result = await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10
    })

    expect(result.text).toBe('你好世界')
    await server.close()
  })
})

describe('事件不能漏（回归测试）', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('流很快时也能收到全部内容', async () => {
    // 模拟"模型很快"的情况：内容几乎瞬间发完。
    // 之前监听器注册晚于主进程发事件，就会漏掉开头甚至全部内容。
    const { startMockServer } = await import('./fixtures/mockServer')
    const server = await startMockServer({ format: 'openai', reply: '很快的回复内容' })

    const received: string[] = []
    const result = await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      onDelta: (t) => received.push(t)
    })

    expect(result.text).toBe('很快的回复内容')
    expect(received.join('')).toBe('很快的回复内容')
    expect(received.length).toBe(7) // 一个字一次，一个都不能少
  })
})

describe('SSE 缓冲（边界情况）', () => {
  it('多个事件挤在一次 push 里也能全部解析出来', () => {
    const buffer = new SseBuffer()
    const lines = buffer.push(
      'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":3}\n\n'
    )
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })

  it('事件被切在 data: 中间也能拼回来', () => {
    const buffer = new SseBuffer()
    expect(buffer.push('da')).toEqual([])
    expect(buffer.push('ta: {"a":1}\n')).toEqual(['{"a":1}'])
  })
})
