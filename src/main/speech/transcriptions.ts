import { httpFetch } from '../http'
import { describeHttpError, describeNetworkError } from '../../shared/llmErrors'
import { cleanTranscript, type SpeechConfig } from '../../shared/speech'
import { SpeechError } from './errors'

/**
 * 转写接口（OpenAI 风格的 /audio/transcriptions）。
 *
 * 请求是 multipart/form-data，字段：
 *   file     audio.wav
 *   model    模型名
 *   language 可选
 * 请求头带 Authorization: Bearer <key>。
 * 返回 JSON，取 text 字段。
 */
export async function transcribeViaTranscriptions(
  wav: Uint8Array,
  options: { config: SpeechConfig; apiKey: string; signal?: AbortSignal }
): Promise<string> {
  const { config, apiKey, signal } = options

  const url = `${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`

  // 组装 multipart 请求体
  const form = new FormData()
  form.append(
    'file',
    new Blob([wav as unknown as BlobPart], { type: 'audio/wav' }),
    'audio.wav'
  )
  form.append('model', config.model)

  // 指定了语言才带这个字段（"自动"时不带，让服务自己判断）
  if (config.language !== 'auto') {
    form.append('language', config.language)
  }

  let response: Response
  try {
    response = await httpFetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`
        // 不要手动设 content-type，FormData 会自己带上 boundary
      },
      body: form,
      signal
    })
  } catch (error) {
    if (signal?.aborted) throw new SpeechError('识别已取消')
    const info = describeNetworkError(error)
    throw new SpeechError(info.message, info.suggestion)
  }

  if (!response.ok) {
    const body = await safeText(response)
    const info = describeHttpError(response.status, body)
    throw new SpeechError(info.message, info.suggestion, info.status)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SpeechError('服务商返回的内容看不懂', '请检查 Base URL 是否指向正确的服务。')
  }

  const obj = json as Record<string, unknown>
  const text = typeof obj.text === 'string' ? obj.text : ''

  return cleanTranscript(text)
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}
