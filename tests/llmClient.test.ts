import { afterEach, describe, expect, it, vi } from 'vitest'
import { startMockServer, type MockServer } from './fixtures/mockServer'
import type { ModelProfile } from '../src/main/profiles'

/**
 * 模型调用的测试。
 *
 * client.ts 里默认用 Electron 的 net 模块发请求（为了走系统代理），
 * 测试时通过 vi.mock 把它换成 Node 的 fetch，这样就能打到一个本地假服务商。
 */

vi.mock('electron', () => {
  /**
   * 包一层 fetch：遇到连接层的偶发失败就重试一次。
   *
   * 原因：Node 的 fetch（undici）按来源维护连接池。上一个测试的假服务商关闭后，
   * 它的端口可能被下一个假服务商重新占用，而池里还留着指向旧服务的死连接，
   * 复用时就报 "fetch failed"。这是测试环境的产物，不是产品代码的问题，
   * 所以在这里重试，而不是改动 client.ts。
   */
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

      // 请求已经被取消时不重试
      if (!isConnectionError || init?.signal?.aborted) throw error

      await new Promise((resolve) => setTimeout(resolve, 20))
      return fetch(url, init)
    }
  }

  return {
    net: { fetch: fetchWithRetry },
    // client.ts 会 import profiles.ts，后者用到 app.getPath
    app: {
      getPath: () => 'C:\\测试目录',
      isPackaged: false
    }
  }
})

const { LlmRequestError, listModels, runChat, testConnection } = await import(
  '../src/main/llm/client'
)

let server: MockServer | null = null

afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
})

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

describe('OpenAI 兼容：请求格式', () => {
  it('发到 {base}/chat/completions，带 Bearer 认证', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    await runChat({
      profile: profile(server.url),
      apiKey: 'sk-test',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
      maxTokens: 10
    })

    const req = server.requests[0]
    expect(req.url).toBe('/chat/completions')
    expect(req.headers['authorization']).toBe('Bearer sk-test')
  })

  it('请求体包含 model、messages、temperature、max_tokens', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    await runChat({
      profile: profile(server.url, { temperature: 0.5 }),
      apiKey: 'k',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
      maxTokens: 123
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.temperature).toBe(0.5)
    expect(body.max_tokens).toBe(123)
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }])
  })

  it('不发送任何与推理相关的参数', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: '你好' }],
      stream: true,
      maxTokens: 10
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.thinking).toBeUndefined()
    expect(body.enable_thinking).toBeUndefined()
  })

  it('流式时 stream 为 true', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: '你好' }],
      stream: true,
      maxTokens: 10
    })
    expect((server.requests[0].body as Record<string, unknown>).stream).toBe(true)
  })
})

describe('Anthropic 兼容：请求格式', () => {
  it('发到 {base}/v1/messages，带 x-api-key 和版本头', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '好' })
    await runChat({
      profile: profile(server.url, { format: 'anthropic' }),
      apiKey: 'sk-ant',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
      maxTokens: 10
    })

    const req = server.requests[0]
    expect(req.url).toBe('/v1/messages')
    expect(req.headers['x-api-key']).toBe('sk-ant')
    expect(req.headers['anthropic-version']).toBe('2023-06-01')
  })

  it('system 消息单独放在 system 字段，messages 里只有 user', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '好' })
    await runChat({
      profile: profile(server.url, { format: 'anthropic' }),
      apiKey: 'k',
      messages: [
        { role: 'system', content: '你是助手' },
        { role: 'user', content: '你好' }
      ],
      stream: false,
      maxTokens: 10
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.system).toBe('你是助手')
    expect(body.messages).toEqual([{ role: 'user', content: '你好' }])
  })

  it('不发送 thinking 参数', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '好' })
    await runChat({
      profile: profile(server.url, { format: 'anthropic' }),
      apiKey: 'k',
      messages: [{ role: 'user', content: '你好' }],
      stream: true,
      maxTokens: 10
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.thinking).toBeUndefined()
  })

  it('base 已经以 /v1 结尾时不重复添加', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '好' })
    await runChat({
      profile: profile(`${server.url}/v1`, { format: 'anthropic' }),
      apiKey: 'k',
      messages: [{ role: 'user', content: '你好' }],
      stream: false,
      maxTokens: 10
    })
    expect(server.requests[0].url).toBe('/v1/messages')
  })
})

describe('流式输出', () => {
  it('OpenAI：逐字拼出完整内容', async () => {
    server = await startMockServer({ format: 'openai', reply: '你好世界' })
    const deltas: string[] = []

    const result = await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      onDelta: (t) => deltas.push(t)
    })

    expect(result.text).toBe('你好世界')
    expect(deltas.join('')).toBe('你好世界')
    expect(deltas.length).toBe(4) // 逐字推送
  })

  it('Anthropic：逐字拼出完整内容', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '你好世界' })
    const deltas: string[] = []

    const result = await runChat({
      profile: profile(server.url, { format: 'anthropic' }),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      onDelta: (t) => deltas.push(t)
    })

    expect(result.text).toBe('你好世界')
    expect(deltas.join('')).toBe('你好世界')
  })

  it('读取 OpenAI 的用量', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    const result = await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10
    })
    expect(result.usage).toEqual({ input: 100, output: 50, cached: 0 })
  })

  it('读取 Anthropic 的用量，含缓存命中', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '好' })
    const result = await runChat({
      profile: profile(server.url, { format: 'anthropic' }),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10
    })
    expect(result.usage).toEqual({ input: 100, output: 50, cached: 20 })
  })
})

describe('忽略思考内容', () => {
  it('OpenAI：reasoning_content 不进正文，但会通知一次', async () => {
    server = await startMockServer({ format: 'openai', reply: '正文', withReasoning: true })
    let notified = 0

    const result = await runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      onReasoning: () => notified++
    })

    expect(result.text).toBe('正文')
    expect(result.text).not.toContain('思考')
    expect(result.sawReasoning).toBe(true)
    expect(notified).toBe(1)
  })

  it('Anthropic：thinking 内容块不进正文', async () => {
    server = await startMockServer({ format: 'anthropic', reply: '正文', withReasoning: true })
    let notified = 0

    const result = await runChat({
      profile: profile(server.url, { format: 'anthropic' }),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      onReasoning: () => notified++
    })

    expect(result.text).toBe('正文')
    expect(result.text).not.toContain('思考')
    expect(result.sawReasoning).toBe(true)
    expect(notified).toBe(1)
  })
})

describe('错误处理', () => {
  it('401 提示 API Key 不正确', async () => {
    server = await startMockServer({ format: 'openai', status: 401 })
    await expect(
      runChat({
        profile: profile(server.url),
        apiKey: 'bad',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10
      })
    ).rejects.toMatchObject({
      info: { message: 'API Key 不正确或没有权限', status: 401 }
    })
  })

  it('429 提示请求太频繁', async () => {
    server = await startMockServer({ format: 'openai', status: 429 })
    await expect(
      runChat({
        profile: profile(server.url),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10
      })
    ).rejects.toMatchObject({
      info: { message: '请求太频繁或额度不足', status: 429 }
    })
  })

  it('500 提示服务商暂时出错', async () => {
    server = await startMockServer({ format: 'openai', status: 500 })
    await expect(
      runChat({
        profile: profile(server.url),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10
      })
    ).rejects.toMatchObject({
      info: { message: '服务商暂时出错', status: 500 }
    })
  })

  it('连不上时提示网络连接失败', async () => {
    await expect(
      runChat({
        // 一个没人监听的端口
        profile: profile('http://127.0.0.1:1', { timeoutMs: 3000 }),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10
      })
    ).rejects.toMatchObject({
      info: { message: '网络连接失败' }
    })
  })

  it('超时提示请求超时', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    // 打一个不存在的慢地址做不到，这里用极短超时 + 一个会挂起的路径来模拟
    await expect(
      runChat({
        profile: profile('http://10.255.255.1', { timeoutMs: 300 }),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10
      })
    ).rejects.toBeInstanceOf(LlmRequestError)
  })
})

describe('Base URL 自动补全 /v1', () => {
  it('404 且地址没有 /v1 时，补上重试一次', async () => {
    const { setFetchForTesting } = await import('../src/main/llm/client')
    const calls: string[] = []

    // 假服务商：只有带 /v1 的地址才认
    server = await startMockServer({ format: 'openai', reply: '好' })
    const realUrl = server.url

    setFetchForTesting(async (url, init) => {
      calls.push(url)
      if (!url.includes('/v1/')) {
        return new Response(JSON.stringify({ error: { message: 'not found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        })
      }
      // 带 /v1 的请求转给假服务商（去掉 /v1）
      return fetch(url.replace('/v1/', '/'), init)
    })

    try {
      const result = await runChat({
        profile: profile(realUrl),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10
      })

      expect(result.text).toBe('好')
      expect(calls).toHaveLength(2)
      expect(calls[0]).not.toContain('/v1/')
      expect(calls[1]).toContain('/v1/')
    } finally {
      setFetchForTesting(null)
    }
  })

  it('地址已经带 /v1 时，404 不重试', async () => {
    const { setFetchForTesting } = await import('../src/main/llm/client')
    const calls: string[] = []

    setFetchForTesting(async (url) => {
      calls.push(url)
      return new Response(JSON.stringify({ error: { message: 'not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    })

    try {
      await expect(
        runChat({
          profile: profile('http://127.0.0.1:9999/v1'),
          apiKey: 'k',
          messages: [{ role: 'user', content: 'x' }],
          stream: false,
          maxTokens: 10
        })
      ).rejects.toMatchObject({ info: { status: 404 } })

      // 只发了一次，没有重试
      expect(calls).toHaveLength(1)
    } finally {
      setFetchForTesting(null)
    }
  })

  it('Anthropic 格式不适用这个补救', async () => {
    const { setFetchForTesting } = await import('../src/main/llm/client')
    const calls: string[] = []

    setFetchForTesting(async (url) => {
      calls.push(url)
      return new Response(JSON.stringify({ error: { message: 'not found' } }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      })
    })

    try {
      await expect(
        runChat({
          profile: profile('http://127.0.0.1:9999', { format: 'anthropic' }),
          apiKey: 'k',
          messages: [{ role: 'user', content: 'x' }],
          stream: false,
          maxTokens: 10
        })
      ).rejects.toMatchObject({ info: { status: 404 } })

      expect(calls).toHaveLength(1)
    } finally {
      setFetchForTesting(null)
    }
  })
})

describe('获取模型列表', () => {
  it('OpenAI：取 data[].id', async () => {
    server = await startMockServer({ format: 'openai', models: ['gpt-4', 'gpt-3.5'] })
    const models = await listModels(profile(server.url), 'k')
    expect(models.map((m) => m.id)).toEqual(['gpt-3.5', 'gpt-4']) // 按名称排序
    expect(server.requests[0].url).toBe('/models')
  })

  it('Anthropic：取 /v1/models', async () => {
    server = await startMockServer({ format: 'anthropic', models: ['claude-x'] })
    const models = await listModels(profile(server.url, { format: 'anthropic' }), 'k')
    expect(models.map((m) => m.id)).toEqual(['claude-x'])
    expect(server.requests[0].url).toBe('/v1/models')
  })

  it('列表按名称排序', async () => {
    server = await startMockServer({ format: 'openai', models: ['z-model', 'a-model', 'm-model'] })
    const models = await listModels(profile(server.url), 'k')
    expect(models.map((m) => m.id)).toEqual(['a-model', 'm-model', 'z-model'])
  })

  it('服务商不支持时抛出中文错误', async () => {
    server = await startMockServer({ format: 'openai', status: 404 })
    await expect(listModels(profile(server.url), 'k')).rejects.toMatchObject({
      info: { status: 404 }
    })
  })
})

describe('测试连接', () => {
  it('成功时返回耗时', async () => {
    server = await startMockServer({ format: 'openai', reply: '好' })
    const result = await testConnection(profile(server.url), 'k')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('输出上限给得足够宽，不会让推理模型把预算用光', async () => {
    // 文档原本写的是"限制最多输出 5 个字"，但推理模型会先用掉一大截预算，
    // 5 个 token 会导致正式回答一个字都出不来。所以放宽到 512。
    server = await startMockServer({ format: 'openai', reply: '好' })
    await testConnection(profile(server.url), 'k')
    const maxTokens = (server.requests[0].body as Record<string, unknown>).max_tokens as number
    expect(maxTokens).toBeGreaterThanOrEqual(256)
  })

  it('仍然要求模型只回复 OK，实际输出很短', async () => {
    server = await startMockServer({ format: 'openai', reply: 'OK' })
    await testConnection(profile(server.url), 'k')
    const messages = (server.requests[0].body as Record<string, unknown>).messages as Array<{
      content: string
    }>
    // 测试提示词不随界面语言变化，固定用英文，避免模型回答被界面语言影响
    expect(messages[0].content).toContain('single word "OK"')
  })

  it('失败时返回中文错误而不是抛异常', async () => {
    server = await startMockServer({ format: 'openai', status: 401 })
    const result = await testConnection(profile(server.url), 'k')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toBe('API Key 不正确或没有权限')
    }
  })
})

describe('取消', () => {
  it('取消后抛出"请求已取消"', async () => {
    server = await startMockServer({ format: 'openai', reply: '好'.repeat(100) })
    const controller = new AbortController()

    const promise = runChat({
      profile: profile(server.url),
      apiKey: 'k',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
      maxTokens: 10,
      signal: controller.signal
    })

    controller.abort()

    await expect(promise).rejects.toMatchObject({
      info: { message: '请求已取消' }
    })
  })

  it('调用前就已经取消时，也报"请求已取消"而不是网络错误', async () => {
    const controller = new AbortController()
    controller.abort() // 提前取消

    await expect(
      runChat({
        profile: profile('http://127.0.0.1:1'),
        apiKey: 'k',
        messages: [{ role: 'user', content: 'x' }],
        stream: false,
        maxTokens: 10,
        signal: controller.signal
      })
    ).rejects.toMatchObject({
      info: { message: '请求已取消' }
    })
  })

  it('超时报"请求超时"，不误报成"请求已取消"', async () => {
    // 一个不会回话的假服务商
    const { createServer } = await import('http')
    const hang = createServer(() => {
      /* 故意不响应 */
    })
    await new Promise<void>((resolve) => hang.listen(0, '127.0.0.1', resolve))
    const addr = hang.address()
    const port = typeof addr === 'object' && addr ? addr.port : 0

    try {
      await expect(
        runChat({
          profile: profile(`http://127.0.0.1:${port}`, { timeoutMs: 400 }),
          apiKey: 'k',
          messages: [{ role: 'user', content: 'x' }],
          stream: false,
          maxTokens: 10
        })
      ).rejects.toMatchObject({
        info: { message: '请求超时' }
      })
    } finally {
      hang.closeAllConnections?.()
      await new Promise<void>((resolve) => hang.close(() => resolve()))
    }
  })
})
