/**
 * 语音输入（API 版）。
 *
 * 设计要点：定义一个统一的"识别引擎"接口，在线 API 是它的一种实现。
 * 以后要加本地模型（sherpa-onnx + SenseVoice）时，只要再实现一个
 * 满足同样接口的引擎，上层代码不用改。
 */

/** 接口类型 */
export type SpeechApiType = 'transcriptions' | 'chat-audio'

/** 识别语言 */
export type SpeechLanguage = 'auto' | 'zh' | 'en'

/** 服务商预设 */
export interface SpeechPreset {
  id: string
  name: string
  baseUrl: string
  model: string
  apiType: SpeechApiType
}

/** 内置预设。第一个是默认选中的。 */
export const SPEECH_PRESETS: SpeechPreset[] = [
  {
    id: 'siliconflow',
    name: '硅基流动（免费）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'FunAudioLLM/SenseVoiceSmall',
    apiType: 'transcriptions'
  },
  {
    id: 'dashscope',
    name: '阿里云百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-asr-flash',
    apiType: 'chat-audio'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'whisper-large-v3-turbo',
    apiType: 'transcriptions'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini-transcribe',
    apiType: 'transcriptions'
  },
  {
    id: 'custom',
    name: '自定义',
    baseUrl: '',
    model: '',
    apiType: 'transcriptions'
  }
]

export const DEFAULT_SPEECH_PRESET = 'siliconflow'

/** 语言选项 */
export const SPEECH_LANGUAGES: Array<{ value: SpeechLanguage; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: '英文' }
]

/** 接口类型的显示名 */
export const API_TYPE_LABELS: Record<SpeechApiType, string> = {
  transcriptions: '转写接口',
  'chat-audio': '聊天接口'
}

/** 识别配置 */
export interface SpeechConfig {
  preset: string
  baseUrl: string
  model: string
  apiType: SpeechApiType
  language: SpeechLanguage
  /** 最长录音时长（秒） */
  maxSeconds: number
}

/**
 * 识别引擎接口。
 *
 * 在线 API 是它的一个实现；以后加本地模型时再实现一个。
 */
export interface SpeechEngine {
  readonly name: string
  /**
   * @param audio 音频字节
   * @param options.mime 音频类型。不传按 audio/wav（麦克风录音就是 WAV）
   * @param options.filename 上传时用的文件名。不传按 audio.wav
   */
  transcribe(
    audio: Uint8Array,
    options: {
      config: SpeechConfig
      apiKey: string
      signal?: AbortSignal
      mime?: string
      filename?: string
    }
  ): Promise<string>
}

// ---------- 音频文件 ----------

/**
 * 支持直接上传的音频扩展名。
 *
 * 不做转码：这些是各家语音服务常见的接收格式，原文件直接交给服务商。
 * 服务商不认的格式会把它的报错显示给用户。
 */
export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'opus',
  'webm',
  'mpga',
  'mp4'
] as const

/** 扩展名 → MIME */
const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  webm: 'audio/webm'
}

/** 是不是可以直接转录的音频文件（传扩展名，带不带点都行） */
export function isAudioFileExt(ext: string): boolean {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  return (AUDIO_EXTENSIONS as readonly string[]).includes(normalized)
}

/** 取扩展名对应的 MIME。不认识的按 audio/mpeg 处理 */
export function audioMimeForExt(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase()
  return AUDIO_MIME[normalized] ?? 'audio/mpeg'
}

/**
 * 音频文件的大小上限。
 *
 * 25 MB 是多数语音服务的通用限制（OpenAI 的 whisper 系列就是 25 MB）。
 * 超过时不做截断，直接提示用户先压缩或截短 —— 悄悄截断会让用户
 * 以为整段都转录了。
 */
export const MAX_AUDIO_FILE_BYTES = 25 * 1024 * 1024

// ---------- 结果清理 ----------

/**
 * 清理识别结果。
 *
 * 去掉首尾空白，以及类似 <|zh|>、<|NEUTRAL|>、<|Speech|> 这样的标签
 * —— 部分 SenseVoice 服务会返回这类标记。
 */
export function cleanTranscript(raw: string): string {
  return raw
    // 去掉所有 <|...|> 形式的标签
    .replace(/<\|[^|]*\|>/g, '')
    // 去掉方括号形式的情感/事件标记（SenseVoice 有时返回）
    .replace(/\[(?:laughter|applause|music|noise|speech|silence|NEUTRAL|HAPPY|SAD|ANGRY|EMO_UNKNOWN)\]/gi, '')
    // 合并多余空白
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 识别结果为空时的提示语 */
export const EMPTY_RESULT_MESSAGE = '没有识别到语音'

// ---------- 录音参数 ----------

/** 识别用的采样率。16kHz 单声道是这类接口的通用要求。 */
export const TARGET_SAMPLE_RATE = 16000

/** 默认最长录音时长（秒） */
export const DEFAULT_MAX_SECONDS = 300

/** 最短录音时长（秒）。太短的录音没有意义。 */
export const MIN_RECORD_SECONDS = 0.3
