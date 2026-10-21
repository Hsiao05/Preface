import { TARGET_SAMPLE_RATE } from '../shared/speech'
import { translate } from '../shared/i18n'
import { useStore } from './store'

/** 当前界面语言下的文案 */
function t(key: Parameters<typeof translate>[1], params?: Record<string, string | number>): string {
  return translate(useStore.getState().uiLanguage, key, params)
}

/**
 * 录音。
 *
 * 用 getUserMedia 拿麦克风，AudioWorklet 采集，重采样成 16kHz 单声道，
 * 停止后编码成 16 位 PCM 的 WAV。
 *
 * 【录音只在内存里】不写磁盘。停止后立刻关闭麦克风（停掉所有音轨），
 * 这样 Windows 任务栏的"正在使用麦克风"提示会立刻消失。
 *
 * 【关于 AudioWorklet】
 * 它需要一个独立的 JS 文件作为处理器。为了不引入额外构建产物，
 * 这里把处理器代码写成字符串，用 Blob URL 加载 —— 效果一样，
 * 但不用配置打包器去处理 worklet 文件。
 */

/** 采集用的 worklet 处理器源码 */
const WORKLET_CODE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._active = true
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this._active = false
    }
  }

  process(inputs) {
    if (!this._active) return false

    const input = inputs[0]
    if (!input || input.length === 0) return true

    // Take the first channel (mono capture)
    const channel = input[0]
    if (channel && channel.length > 0) {
      // Copy before posting: this buffer is reused by the audio thread
      this.port.postMessage(new Float32Array(channel))
    }
    return true
  }
}

registerProcessor('capture-processor', CaptureProcessor)
`

export interface RecorderEvents {
  /** 采集到的音量（0 到 1），用于画音量条 */
  onLevel?: (level: number) => void
  /** 出错了 */
  onError?: (error: Error) => void
}

export class Recorder {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private workletNode: AudioWorkletNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private chunks: Float32Array[] = []
  private inputSampleRate = 48000
  private events: RecorderEvents
  private stopping = false

  constructor(events: RecorderEvents = {}) {
    this.events = events
  }

  /** 是不是正在录音 */
  get active(): boolean {
    return this.stream !== null
  }

  /**
   * 开始录音。
   * 拿不到麦克风时抛出带中文说明的错误。
   */
  async start(): Promise<void> {
    if (this.stream) return

    this.chunks = []
    this.stopping = false

    // 1. 拿麦克风
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      })
    } catch (error) {
      throw this.describeMediaError(error)
    }

    // 2. 建立音频上下文
    try {
      this.context = new AudioContext()
      this.inputSampleRate = this.context.sampleRate

      // 3. 加载 worklet 处理器
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' })
      const url = URL.createObjectURL(blob)
      try {
        await this.context.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }

      // 4. 接线：麦克风 → worklet
      this.workletNode = new AudioWorkletNode(this.context, 'capture-processor')
      this.workletNode.port.onmessage = (event: MessageEvent): void => {
        const chunk = event.data as Float32Array
        if (!this.stopping) {
          this.chunks.push(chunk)
          this.events.onLevel?.(computeLevel(chunk))
        }
      }

      this.source = this.context.createMediaStreamSource(this.stream)
      this.source.connect(this.workletNode)

      // worklet 不连到扬声器，避免把麦克风的声音放出来
      // （但某些浏览器要求节点必须连到 destination 才会运行，
      //   所以接一个静音的增益节点）
      const silent = this.context.createGain()
      silent.gain.value = 0
      this.workletNode.connect(silent)
      silent.connect(this.context.destination)
    } catch (error) {
      this.cleanup()
      throw new Error(
        t('recorder.initFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      )
    }
  }

  /**
   * 停止录音，返回 16kHz 单声道 16 位 PCM 的 WAV 数据。
   * 无论成功与否，麦克风都会被关掉。
   */
  async stop(): Promise<Uint8Array> {
    if (!this.stream) return new Uint8Array(0)

    this.stopping = true

    // 等一小会儿，让 worklet 把最后几块数据发过来
    await new Promise((resolve) => setTimeout(resolve, 80))

    const chunks = this.chunks
    const inputRate = this.inputSampleRate

    // 先关麦克风，再慢慢处理数据 —— 这样任务栏的提示立刻消失
    this.cleanup()

    const merged = mergeChunks(chunks)
    if (merged.length === 0) return new Uint8Array(0)

    const resampled = resample(merged, inputRate, TARGET_SAMPLE_RATE)
    return encodeWav(resampled, TARGET_SAMPLE_RATE)
  }

  /** 放弃这次录音，不返回数据 */
  abort(): void {
    this.stopping = true
    this.chunks = []
    this.cleanup()
  }

  /** 关闭麦克风和音频上下文 */
  private cleanup(): void {
    try {
      this.workletNode?.port.postMessage('stop')
      this.workletNode?.disconnect()
    } catch {
      // 忽略
    }
    this.workletNode = null

    try {
      this.source?.disconnect()
    } catch {
      // 忽略
    }
    this.source = null

    // 关掉所有音轨 —— 这一步让系统的"正在使用麦克风"提示消失
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop()
      }
    }
    this.stream = null

    if (this.context) {
      void this.context.close().catch(() => {})
      this.context = null
    }
  }

  /** 把 getUserMedia 的错误翻成当前界面语言的说明 */
  private describeMediaError(error: unknown): Error {
    const name = error instanceof Error ? error.name : ''

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return new Error(t('recorder.permission'))
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return new Error(t('recorder.noMic'))
    }
    if (name === 'NotReadableError') {
      return new Error(t('recorder.busy'))
    }

    return new Error(
      t('recorder.generic', {
        message: error instanceof Error ? error.message : String(error)
      })
    )
  }
}

/** 把多块 Float32Array 拼成一块 */
function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const merged = new Float32Array(total)

  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  return merged
}

/**
 * 重采样。
 *
 * 用线性插值 —— 对语音识别来说足够了，而且比卷积类方法快得多。
 * 目标是 16kHz 单声道，这是语音识别接口的通用要求。
 */
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input

  const ratio = fromRate / toRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index

    const a = input[index] ?? 0
    const b = input[index + 1] ?? a
    output[i] = a + (b - a) * fraction
  }

  return output
}

/** 编码成 16 位 PCM 的 WAV */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const dataSize = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  // RIFF 头
  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, 'WAVE')

  // fmt 块
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true) // 块长度
  view.setUint16(20, 1, true) // 格式：1 = PCM
  view.setUint16(22, 1, true) // 声道数：单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true) // 每秒字节数
  view.setUint16(32, bytesPerSample, true) // 每个采样点的字节数
  view.setUint16(34, 16, true) // 位深

  // data 块
  writeString(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  // 采样数据：Float32 (-1..1) → Int16
  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
    offset += 2
  }

  return new Uint8Array(buffer)
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i))
  }
}

/** 算这一块的音量（均方根），返回 0 到 1 */
function computeLevel(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
  const rms = Math.sqrt(sum / chunk.length)
  // 放大一下，让音量条在小音量下也看得出来
  return Math.min(1, rms * 4)
}

/** 把秒数格式化成 mm:ss */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
