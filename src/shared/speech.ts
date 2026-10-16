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
  transcribe(
    wav: Uint8Array,
    options: { config: SpeechConfig; apiKey: string; signal?: AbortSignal }
  ): Promise<string>
}

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
