import { useCallback, useRef, useState } from 'react'
import { useStore } from './store'
import { translate } from '../shared/i18n'
import type { MessageKey, UiLanguage } from '../shared/i18n'
import type { CallKind } from '../main/llm'
import type { LlmStreamEvent } from '../preload/index'
import type { UsageInfo } from '../shared/sse'

/** 调用结束时带回来的信息，用于给出准确的提示 */
export interface DoneInfo {
  sawReasoning: boolean
  truncated: boolean
  reasoningTokens: number
}

/**
 * 输出被截断时的提示。
 *
 * 用户要求：推理模型导致输出不完整时，要明确告诉用户两条出路
 * —— 换非推理模型，或者调大最大输出长度。
 */
export function buildTruncatedMessage(info: DoneInfo, language: UiLanguage = 'zh'): string {
  const t = (key: MessageKey, params?: Record<string, string | number>): string =>
    translate(language, key, params)
  const parts: string[] = [t('truncated.tidy')]

  if (info.sawReasoning) {
    const used =
      info.reasoningTokens > 0
        ? t('truncated.reasoningTokens', {
            count: info.reasoningTokens.toLocaleString(
              language === 'en' ? 'en-US' : 'zh-CN'
            )
          })
        : ''
    parts.push(t('truncated.reasoning', { tokens: used }))
  } else {
    parts.push(t('truncated.increaseMaxTokens'))
  }

  return parts.join('')
}

/** 结果为空时的提示 */
export function buildEmptyResultMessage(info: DoneInfo, language: UiLanguage = 'zh'): string {
  if (info.sawReasoning) {
    return translate(language, 'empty.reasoning')
  }
  return translate(language, 'empty.tidy')
}

/** 一次进行中的调用 */
export interface RunningCall {
  kind: CallKind
  requestId: string
}

export interface LlmRunState {
  running: RunningCall | null
  /** 流式收到的文字，供界面实时显示 */
  streamText: string
  /** 最近的用量 */
  usage: UsageInfo | null
}

/**
 * 模型调用的统一入口。
 *
 * 负责：发起调用、接收流式事件、取消、错误提示。
 * 具体的提示词组装由调用方传入 messages。
 */
export function useLlmRun(): {
  state: LlmRunState
  run: (
    kind: CallKind,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    options: {
      sourceText?: string
      onDone?: (text: string, info: DoneInfo) => void
      onError?: (message: string) => void
      /** 每收到一段正文就回调一次，供调用方自己处理流式显示 */
      onDelta?: (chunk: string) => void
      /** 收到用量时回调 */
      onUsage?: (usage: UsageInfo) => void
      /** 流式过程中是否把增量写进内置的 streamText */
      trackStream?: boolean
    }
  ) => Promise<string | null>
  /** 取消。silent 为 true 时不弹「已取消。」（用户自己动手导致作废时用） */
  cancel: (silent?: boolean) => void
} {
  const [state, setState] = useState<LlmRunState>({
    running: null,
    streamText: '',
    usage: null
  })
  const requestIdRef = useRef<string | null>(null)
  // 用户是否点过取消。迟到的 done 事件要靠它来判断该不该生效。
  const cancelledRef = useRef(false)
  // 上一次调用里模型是否输出了思考内容，供提示语使用
  const sawReasoningRef = useRef(false)

  const run = useCallback(
    async (
      kind: CallKind,
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      options: {
        sourceText?: string
        onDone?: (text: string, info: DoneInfo) => void
        onError?: (message: string) => void
        /** 每收到一段正文就回调一次，供调用方自己处理流式显示 */
        onDelta?: (chunk: string) => void
        /** 收到用量时回调 */
        onUsage?: (usage: UsageInfo) => void
        trackStream?: boolean
      } = {}
    ): Promise<string | null> => {
      const setNotice = useStore.getState().setNotice
      const trackStream = options.trackStream ?? true
      const t = (key: MessageKey, params?: Record<string, string | number>): string =>
        translate(useStore.getState().uiLanguage, key, params)

      let accumulated = ''
      let finalText: string | null = null
      // 模型这次是否输出了思考内容，用于给出更准确的提示
      let sawReasoning = false
      // 输出是否被 max_tokens 截断
      let truncated = false
      // 推理用掉的 token 数
      let reasoningTokens = 0

      // 用户点过取消之后，迟到的 done 事件不能再触发 onDone。
      // 用 ref 记录，因为 cancel 是另一个函数，需要能看到它。
      cancelledRef.current = false
      sawReasoningRef.current = false
      const isCancelled = (): boolean => cancelledRef.current

      const handleEvent = (event: LlmStreamEvent): void => {
        if (isCancelled()) return

        switch (event.type) {
          case 'delta':
            if (event.text) {
              accumulated += event.text
              // 调用方自己的流式处理优先
              options.onDelta?.(event.text)
              if (trackStream) {
                setState((prev) => ({ ...prev, streamText: accumulated }))
              }
            }
            break

          case 'usage':
            if (event.usage) {
              options.onUsage?.(event.usage)
              setState((prev) => ({ ...prev, usage: event.usage! }))
            }
            break

          case 'reasoning':
            // 只在第一次提示
            setNotice({
              kind: 'info',
              text: t('notice.reasoning')
            })
            break

          case 'privacy-notice':
            setNotice({
              kind: 'info',
              text: t('notice.privacy')
            })
            break

          case 'done':
            finalText = event.text ?? accumulated
            sawReasoning = event.sawReasoning === true
            truncated = event.truncated === true
            reasoningTokens = event.reasoningTokens ?? 0
            break

          case 'error': {
            const error = event.error
            const text = error
              ? `${error.message}${error.suggestion ? ' ' + error.suggestion : ''}`
              : t('notice.requestFailed')
            options.onError?.(text)
            setNotice({ kind: 'warning', text })
            break
          }
        }
      }

      try {
        const { requestId, done } = await window.preface.runLlm(
          kind,
          messages,
          options.sourceText,
          handleEvent
        )

        requestIdRef.current = requestId
        setState({ running: { kind, requestId }, streamText: '', usage: null })

        await done
        requestIdRef.current = null

        if (isCancelled()) {
          return null
        }

        sawReasoningRef.current = sawReasoning

        if (finalText !== null) {
          options.onDone?.(finalText, { sawReasoning, truncated, reasoningTokens })
        }

        // 【重要】结束时必须清掉 streamText，
        // 否则编辑器会一直停在"流式预览"那个分支，用户看不到正常界面。
        setState((prev) => ({ ...prev, running: null, streamText: '' }))
        return finalText
      } catch (error) {
        requestIdRef.current = null
        setState({ running: null, streamText: '', usage: null })
        const text = error instanceof Error ? error.message : String(error)
        setNotice({ kind: 'warning', text: t('notice.callFailed', { message: text }) })
        options.onError?.(text)
        return null
      }
    },
    []
  )

  /**
   * 取消在途请求。
   *
   * silent 用于"用户一动手，旧请求就该作废"的场景（例如在标题框里打字），
   * 这时不需要弹「已取消。」，用户并没有主动点取消。
   */
  const cancel = useCallback((silent = false): void => {
    // 先立起标志，这样随后可能到达的 done 事件不会生效
    cancelledRef.current = true

    const id = requestIdRef.current
    if (id) {
      void window.preface.cancelLlm(id)
      requestIdRef.current = null
    }
    // 立刻清掉流式预览，界面马上回到可编辑状态
    setState({ running: null, streamText: '', usage: null })
    if (!silent) {
      useStore.getState().setNotice({
        kind: 'info',
        text: translate(useStore.getState().uiLanguage, 'notice.cancelled')
      })
    }
  }, [])

  return { state, run, cancel }
}
