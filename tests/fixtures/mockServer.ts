import { createServer, type Server } from 'http'

/**
 * 一个最小的假服务商，用来验证请求格式和 SSE 解析。
 *
 * 【为什么用一个常驻服务器】
 * Node 的 fetch（undici）按来源维护连接池。如果每个测试都起一个新服务器、
 * 用完就关，端口会被反复分配回收，池里残留的旧连接就可能被复用到新服务器上，
 * 造成随机的 "fetch failed"。所以这里只起一个服务器，整个测试文件共用，
 * 每个测试通过 reset() 换掉它的行为。
 */

export interface MockServerOptions {
  format: 'openai' | 'anthropic'
  /** 逐字返回的内容 */
  reply?: string
  /** 是否返回思考内容 */
  withReasoning?: boolean
  /** 返回的 HTTP 状态码，用来测错误处理 */
  status?: number
  /** 模型列表接口返回的内容 */
  models?: string[]
}

export interface RecordedRequest {
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface MockServer {
  url: string
  requests: RecordedRequest[]
  /** 换一套行为，并清空已记录的请求 */
  reset: (options: MockServerOptions) => void
  /** 兼容旧写法：关掉服务器（实际上不关，只清空行为） */
  close: () => Promise<void>
}

/** 默认行为：没配置时返回 404 */
const IDLE: MockServerOptions = { format: 'openai', status: 404 }

export async function startMockServer(options: MockServerOptions): Promise<MockServer> {
  const shared = await getSharedServer()
  shared.requests.length = 0
  shared.current = options
  return {
    url: shared.url,
    requests: shared.requests,
    reset: (next) => {
      shared.requests.length = 0
      shared.current = next
    },
    // 不真的关服务器，只是恢复成空闲状态，避免端口反复分配
    close: async () => {
      shared.current = IDLE
      shared.requests.length = 0
    }
  }
}

interface SharedServer {
  url: string
  requests: RecordedRequest[]
  current: MockServerOptions
}

let shared: SharedServer | null = null
let starting: Promise<SharedServer> | null = null

async function getSharedServer(): Promise<SharedServer> {
  if (shared) return shared
  if (starting) return starting

  starting = (async () => {
    const requests: RecordedRequest[] = []
    const state: SharedServer = { url: '', requests, current: IDLE }

    const server: Server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        let body: unknown = null
        try {
          body = raw ? JSON.parse(raw) : null
        } catch {
          body = raw
        }

        const headers: Record<string, string> = {}
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === 'string') headers[k.toLowerCase()] = v
        }

        requests.push({ url: req.url ?? '', headers, body })

        const options = state.current
        const status = options.status ?? 200

        // 所有响应都带上 Connection: close，减少连接复用带来的干扰
        const baseHeaders = { connection: 'close' }

        // 模型列表
        if (req.url?.includes('/models')) {
          if (status !== 200) {
            res.writeHead(status, { ...baseHeaders, 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { message: '错误' } }))
            return
          }
          res.writeHead(200, { ...baseHeaders, 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              data: (options.models ?? ['model-a', 'model-b']).map((id) => ({ id }))
            })
          )
          return
        }

        if (status !== 200) {
          res.writeHead(status, { ...baseHeaders, 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: '模拟的错误' } }))
          return
        }

        // 语音转写：multipart 上传，返回 { text }
        if (req.url?.includes('/audio/transcriptions')) {
          res.writeHead(200, { ...baseHeaders, 'content-type': 'application/json' })
          res.end(JSON.stringify({ text: options.reply ?? '识别结果' }))
          return
        }

        // 对话
        const wantsStream = (body as Record<string, unknown>)?.stream === true
        const reply = options.reply ?? '整理后的内容'

        if (!wantsStream) {
          res.writeHead(200, { ...baseHeaders, 'content-type': 'application/json' })
          if (options.format === 'openai') {
            res.end(
              JSON.stringify({
                choices: [{ message: { role: 'assistant', content: reply } }],
                usage: { prompt_tokens: 100, completion_tokens: 50 }
              })
            )
          } else {
            res.end(
              JSON.stringify({
                content: [{ type: 'text', text: reply }],
                usage: { input_tokens: 100, output_tokens: 50 }
              })
            )
          }
          return
        }

        // 流式
        res.writeHead(200, {
          ...baseHeaders,
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache'
        })

        const send = (data: unknown): void => {
          res.write(`data: ${JSON.stringify(data)}\n\n`)
        }

        if (options.format === 'openai') {
          if (options.withReasoning) {
            send({ choices: [{ delta: { reasoning_content: '我在思考…' } }] })
          }
          for (const char of reply) {
            send({ choices: [{ delta: { content: char } }] })
          }
          send({ choices: [{ delta: {} }], usage: { prompt_tokens: 100, completion_tokens: 50 } })
          res.write('data: [DONE]\n\n')
        } else {
          send({
            type: 'message_start',
            message: { usage: { input_tokens: 100, cache_read_input_tokens: 20 } }
          })
          if (options.withReasoning) {
            send({ type: 'content_block_start', content_block: { type: 'thinking' } })
            send({
              type: 'content_block_delta',
              delta: { type: 'thinking_delta', thinking: '我在思考…' }
            })
          }
          send({ type: 'content_block_start', content_block: { type: 'text', text: '' } })
          for (const char of reply) {
            send({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text: char }
            })
          }
          send({ type: 'message_delta', usage: { output_tokens: 50 } })
        }

        res.end()
      })
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0

    state.url = `http://127.0.0.1:${port}`
    // 服务器一直活着，测试跑完后由进程退出回收
    server.unref?.()
    shared = state
    return state
  })()

  return starting
}
