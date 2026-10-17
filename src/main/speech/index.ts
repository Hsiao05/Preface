import { BrowserWindow } from 'electron'
import { log } from '../logger'
import {
  DEFAULT_MAX_SECONDS,
  DEFAULT_SPEECH_PRESET,
  SPEECH_PRESETS,
  type SpeechConfig,
  type SpeechEngine
} from '../../shared/speech'
import { SpeechError } from './errors'
import { transcribeViaTranscriptions } from './transcriptions'
import { transcribeViaChatAudio } from './chatAudio'

/**
 * 语音识别的调度层。
 *
 * 【引擎接口】
 * SpeechEngine 定义了 transcribe(wav, options) → Promise<string>。
 * 现在只有"在线 API"一种实现；以后加本地模型（sherpa-onnx + SenseVoice）
 * 时，再实现一个满足同样接口的引擎，换掉这里的 engine 即可，
 * 上层的 IPC 和界面代码都不用动。
 */

/** 在线 API 引擎。按 apiType 分派到两种请求格式。 */
const onlineApiEngine: SpeechEngine = {
  name: '在线 API',
  async transcribe(audio, { config, apiKey, signal, mime, filename }) {
    const options = { config, apiKey, signal, mime, filename }
    if (config.apiType === 'chat-audio') {
      return transcribeViaChatAudio(audio, options)
    }
    return transcribeViaTranscriptions(audio, options)
  }
}

/** 当前使用的引擎。以后支持本地模型时，这里按设置切换。 */
function currentEngine(): SpeechEngine {
  return onlineApiEngine
}

/** 识别用的密钥在 secrets 里的 id，和提示词优化的 Key 分开存 */
export const SPEECH_SECRET_ID = 'speech'

// ---------- 进行中的识别 ----------

let activeController: AbortController | null = null

/** 取消正在进行的识别 */
export function cancelTranscribe(): boolean {
  if (!activeController) return false
  activeController.abort()
  activeController = null
  log('已取消语音识别')
  return true
}

// ---------- 主入口 ----------

export interface TranscribeInput {
  /** 音频字节。麦克风录音是 16kHz WAV；文件转录是原文件内容 */
  audio: Uint8Array
  config: SpeechConfig
  apiKey: string
  timeoutMs?: number
  /** 音频类型。不传按 audio/wav */
  mime?: string
  /** 上传时用的文件名。不传按 audio.wav */
  filename?: string
}

/**
 * 识别一段音频。
 * 同一时间只允许一个识别在进行，新的会取消旧的。
 */
export async function transcribe(input: TranscribeInput): Promise<string> {
  // 先把上一个取消掉
  cancelTranscribe()

  const controller = new AbortController()
  activeController = controller

  const timeoutMs = input.timeoutMs ?? 60000
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  log(
    `开始语音识别（${currentEngine().name}，模型 ${input.config.model}，` +
      `音频 ${input.audio.length} 字节）`
  )

  try {
    const text = await currentEngine().transcribe(input.audio, {
      config: input.config,
      apiKey: input.apiKey,
      signal: controller.signal,
      mime: input.mime,
      filename: input.filename
    })

    log(`语音识别完成，识别出 ${text.length} 字`)
    return text
  } catch (error) {
    if (timedOut) {
      throw new SpeechError('识别超时', '服务商响应太慢，可以稍后再试。')
    }
    if (controller.signal.aborted) {
      throw new SpeechError('识别已取消')
    }
    if (error instanceof SpeechError) {
      throw error
    }
    throw new SpeechError('识别失败', '请检查设置里的语音配置。')
  } finally {
    clearTimeout(timer)
    if (activeController === controller) activeController = null
  }
}

// ---------- 配置工具 ----------

/** 按预设 id 取预设 */
export function presetById(id: string): (typeof SPEECH_PRESETS)[number] | undefined {
  return SPEECH_PRESETS.find((p) => p.id === id)
}

/** 默认的语音配置 */
export function defaultSpeechConfig(): SpeechConfig {
  const preset = presetById(DEFAULT_SPEECH_PRESET)!
  return {
    preset: preset.id,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiType: preset.apiType,
    language: 'auto',
    maxSeconds: DEFAULT_MAX_SECONDS
  }
}

/** 语音配置是否可用（有地址、有模型、有 Key） */
export function isSpeechConfigured(config: SpeechConfig, hasKey: boolean): boolean {
  return Boolean(config.baseUrl.trim() && config.model.trim() && hasKey)
}

/** 通知所有窗口语音配置变了 */
export function notifySpeechConfigChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('speech:config-changed')
  }
}

export { SpeechError }
