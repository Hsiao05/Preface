import { httpFetch } from '../http'
import { describeHttpError, describeNetworkError } from '../../shared/llmErrors'
import { getUiLanguage, mainT } from '../i18n'
import { cleanTranscript, type SpeechConfig } from '../../shared/speech'
import { SpeechError } from './errors'

/**
 * 转写接口（OpenAI 风格的 /audio/transcriptions）。
 *
 * 请求是 multipart/form-data，字段：
 *   file     audio.wav（麦克风录音）或原音频文件名（文件转录）
 *   model    模型名
 *   language 可选
 * 请求头带 Authorization: Bearer <key>。
 * 返回 JSON，取 text 字段。
 */
export async function transcribeViaTranscriptions(
  audio: Uint8Array,
  options: {
    config: SpeechConfig
    apiKey: string
    signal?: AbortSignal
    /** 音频类型。不传按 audio/wav（麦克风录的是 WAV） */
    mime?: string
    /** 上传时用的文件名。不传按 audio.wav */
    filename?: string
  }
): Promise<string> {
  const { config, apiKey, signal } = options
  const mime = options.mime ?? 'audio/wav'
  const filename = options.filename ?? 'audio.wav'

  const url = `${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`

  // 组装 multipart 请求体
  const form = new FormData()
  form.append('file', new Blob([audio as unknown as BlobPart], { type: mime }), filename)
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
    if (signal?.aborted) throw new SpeechError(mainT('speech.cancelled'))
    const info = describeNetworkError(error, getUiLanguage())
    throw new SpeechError(info.message, info.suggestion)
  }

  if (!response.ok) {
    const body = await safeText(response)
    const info = describeHttpError(response.status, body, getUiLanguage())
    throw new SpeechError(info.message, info.suggestion, info.status)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new SpeechError(mainT('speech.badResponse'), mainT('speech.badResponseHint'))
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
