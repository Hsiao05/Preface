import { useCallback, useEffect, useRef, useState } from 'react'
import { Recorder } from './recorder'
import { useStore } from './store'
import { useT } from './i18n'
import { cleanTranscript, MIN_RECORD_SECONDS } from '../shared/speech'

/**
 * 语音输入。
 *
 * 状态机：idle → recording → transcribing → idle
 *
 * 【停止的方式】
 * 录音期间，按键盘任意键、或在窗口内任意位置点击鼠标，都会停止并开始识别。
 * 但那次按键/点击必须被"吃掉" —— 不能让它输入到文本框，也不能触发
 * 被点到的按钮。所以在捕获阶段监听并阻止默认行为。
 *
 * Esc 是例外：停止并放弃，不识别。
 */

export type VoiceState = 'idle' | 'recording' | 'transcribing'

export interface VoiceInputApi {
  state: VoiceState
  /** 录音已进行的秒数 */
  elapsed: number
  /** 当前音量 0 到 1，用于画音量条 */
  level: number
  /** 开始录音 */
  start: () => Promise<void>
  /** 主动取消识别 */
  cancelTranscribe: () => void
  /** 录音进行中时，这次事件是不是"停止录音" */
  isRecording: boolean
}

/** 插入文本时用的回调。由编辑器提供。 */
export type InsertText = (text: string) => void

export function useVoiceInput(insertText: InsertText): VoiceInputApi {
  const t = useT()
  const [state, setState] = useState<VoiceState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)

  const recorderRef = useRef<Recorder | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const maxSecondsRef = useRef(300)
  /** 这次录音是不是要放弃 */
  const discardRef = useRef(false)
  /** 停止监听已经挂上了没有 */
  const listeningRef = useRef(false)

  const setNotice = useStore((s) => s.setNotice)

  /** 清理计时器 */
  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 停止录音并识别 */
  const stopAndTranscribe = useCallback(
    async (discard: boolean): Promise<void> => {
      const recorder = recorderRef.current
      if (!recorder || !recorder.active) return

      clearTimer()
      listeningRef.current = false

      if (discard) {
        recorder.abort()
        recorderRef.current = null
        setState('idle')
        setElapsed(0)
        setLevel(0)
        return
      }

      // 录得太短就不发请求了
      const duration = (Date.now() - startedAtRef.current) / 1000
      if (duration < MIN_RECORD_SECONDS) {
        recorder.abort()
        recorderRef.current = null
        setState('idle')
        setElapsed(0)
        setLevel(0)
        setNotice({ kind: 'warning', text: t('voice.tooShort') })
        return
      }

      setState('transcribing')
      setLevel(0)

      let wav: Uint8Array
      try {
        wav = await recorder.stop()
      } catch (error) {
        recorderRef.current = null
        setState('idle')
        setNotice({
          kind: 'warning',
          text: t('voice.stopFailed', {
            message: error instanceof Error ? error.message : String(error)
          })
        })
        return
      }
      recorderRef.current = null

      if (wav.length === 0) {
        setState('idle')
        setNotice({ kind: 'warning', text: t('voice.noSound') })
        return
      }

      // 交给主进程识别
      const result = await window.preface.transcribeAudio(
        wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
      )

      setState('idle')
      setElapsed(0)

      if (!result.ok) {
        setNotice({
          kind: 'warning',
          text: result.error.suggestion
            ? t('speech.errorWithSuggestion', {
                message: result.error.message,
                suggestion: result.error.suggestion
              })
            : result.error.message
        })
        return
      }

      const text = cleanTranscript(result.text)
      if (!text) {
        setNotice({ kind: 'warning', text: t('audio.emptyResult') })
        return
      }

      insertText(text)
    },
    [clearTimer, insertText, setNotice, t]
  )

  /** 开始录音 */
  const start = useCallback(async (): Promise<void> => {
    if (state !== 'idle') return

    // 先确认配置齐全，免得录完了才发现没配
    const info = await window.preface.getSpeechConfig()
    if (!info.configured) {
      setNotice({
        kind: 'warning',
        text: t('audio.notConfigured')
      })
      return
    }

    maxSecondsRef.current = info.config.maxSeconds || 300
    discardRef.current = false

    const recorder = new Recorder({
      onLevel: (value) => setLevel(value),
      onError: (error) => {
        setNotice({ kind: 'warning', text: error.message })
      }
    })

    try {
      await recorder.start()
    } catch (error) {
      recorderRef.current = null
      setState('idle')
      setNotice({
        kind: 'warning',
        text: error instanceof Error ? error.message : t('settings.speech.cannotStart')
      })
      return
    }

    recorderRef.current = recorder
    startedAtRef.current = Date.now()
    setElapsed(0)
    setState('recording')

    // 计时 + 到时自动停止
    timerRef.current = setInterval(() => {
      const seconds = (Date.now() - startedAtRef.current) / 1000
      setElapsed(seconds)

      if (seconds >= maxSecondsRef.current) {
        setNotice({
          kind: 'info',
          text: t('voice.maxReached', {
            minutes: Math.round(maxSecondsRef.current / 60)
          })
        })
        void stopAndTranscribe(false)
      }
    }, 200)
  }, [setNotice, state, stopAndTranscribe, t])

  /** 取消识别 */
  const cancelTranscribe = useCallback((): void => {
    void window.preface.cancelTranscribe()
    setState('idle')
    setNotice({ kind: 'info', text: t('voice.cancelled') })
  }, [setNotice, t])

  // ---------- 录音期间的"任意键/任意点击停止" ----------
  useEffect(() => {
    if (state !== 'recording') return

    /*
     * 【为什么用捕获阶段】
     * 停止录音的那一次按键或点击必须被"吃掉"：
     * 按键不能输入到文本框，点击不能触发被点到的按钮（比如"一键复制"）。
     * 捕获阶段在事件到达目标元素之前就拦下，调用 preventDefault 和
     * stopPropagation，后面的处理器就都不会跑。
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      // 正在用输入法组字时不算（避免误判）
      if (event.isComposing || event.keyCode === 229) return

      event.preventDefault()
      event.stopPropagation()

      // Esc：停止并放弃
      if (event.key === 'Escape') {
        discardRef.current = true
        void stopAndTranscribe(true)
        return
      }

      void stopAndTranscribe(false)
    }

    const onMouseDown = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      void stopAndTranscribe(false)
    }

    // 挂监听前先等一拍：开始录音的那一次点击不能被当成停止
    const id = window.setTimeout(() => {
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('mousedown', onMouseDown, true)
      listeningRef.current = true
    }, 0)

    return () => {
      window.clearTimeout(id)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      listeningRef.current = false
    }
  }, [state, stopAndTranscribe])

  // ---------- 窗口隐藏或失焦时停止 ----------
  useEffect(() => {
    if (state !== 'recording') return

    const onBlur = (): void => {
      if (recorderRef.current?.active) void stopAndTranscribe(false)
    }
    const onVisibility = (): void => {
      if (document.hidden && recorderRef.current?.active) void stopAndTranscribe(false)
    }

    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [state, stopAndTranscribe])

  // 组件卸载时确保麦克风被关掉
  useEffect(() => {
    return () => {
      clearTimer()
      recorderRef.current?.abort()
      recorderRef.current = null
    }
  }, [clearTimer])

  return {
    state,
    elapsed,
    level,
    start,
    cancelTranscribe,
    isRecording: state === 'recording'
  }
}
