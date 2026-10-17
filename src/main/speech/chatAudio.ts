import { httpFetch } from '../http'
import { describeHttpError, describeNetworkError } from '../../shared/llmErrors'
import { cleanTranscript, type SpeechConfig } from '../../shared/speech'
import { SpeechError } from './errors'

/**
 * 聊天接口（把音频当附件发给 /chat/completions）。
 *
 * 请求是 JSON，stream 为 false。
 * messages 里只有一条 user 消息，content 是一个内容块数组：
 *   [{ "type": "input_audio", "input_audio": { "data": "data:audio/wav;base64,..." } }]
 * 指定了语言时附加 asr_options。
 * 取 choices[0].message.content。
 */
export async function transcribeViaChatAudio(
  audio: Uint8Array,
  options: {
    config: SpeechConfig
    apiKey: string
    signal?: AbortSignal
    /** 音频类型。不传按 audio/wav（麦克风录的是 WAV） */
    mime?: string
    /** 这里用不到文件名，和转写接口保持同一个参数形状 */
    filename?: string
  }
): Promise<string> {
  const { config, apiKey, signal } = options
  const mime = options.mime ?? 'audio/wav'

  const url = `${config.baseUrl.replace(/\/+$/, '')}/chat/completions`

  // 转成 data URI
  const base64 = bytesToBase64(audio)
  const dataUri = `data:${mime};base64,${base64}`

  const body: Record<string, unknown> = {
    model: config.model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: { data: dataUri }
          }
        ]
      }
    ]
  }

  // 指定了语言才带 asr_options
  if (config.language !== 'auto') {
    body.asr_options = { language: config.language }
  }

  let response: Response
  try {
    response = await httpFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })
  } catch (error) {
    if (signal?.aborted) throw new SpeechError('识别已取消')
    const info = describeNetworkError(error)
    throw new SpeechError(info.message, info.suggestion)
  }

  if (!response.ok) {
    const text = await safeText(response)
    const info = describeHttpError(response.status, text)
    throw new SpeechError(info.message, info.suggestion, info.status)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SpeechError('服务商返回的内容看不懂', '请检查 Base URL 是否指向正确的服务。')
  }

  const obj = json as Record<string, unknown>
  const choices = obj.choices

  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  const message = (choices[0] as Record<string, unknown>).message as
    | Record<string, unknown>
    | undefined
  const content = message?.content

  // 有的服务把 content 做成内容块数组
  if (Array.isArray(content)) {
    let text = ''
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const b = block as Record<string, unknown>
      if (b.type === 'text' && typeof b.text === 'string') text += b.text
    }
    return cleanTranscript(text)
  }

  return cleanTranscript(typeof content === 'string' ? content : '')
}

/** Uint8Array 转 base64。分块处理，避免大数组时栈溢出。 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    binary += String.fromCharCode(...slice)
  }
  return btoa(binary)
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
