import { useCallback, useRef, useState } from 'react'
import { useStore } from './store'
import { buildTidyMessages } from '../shared/buildMessages'
import { toOverrides } from './usePromptOverrides'
import { stripMarkdown } from '../shared/stripMarkdown'
import { missingCommands } from '../shared/commands'
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
export function buildTruncatedMessage(info: DoneInfo): string {
  const parts: string[] = ['整理完成了，但输出被截断，结果可能不完整。']

  if (info.sawReasoning) {
    const used =
      info.reasoningTokens > 0 ? `（其中约 ${info.reasoningTokens} tokens 用在了思考上）` : ''
    parts.push(
      `这个模型带推理过程，思考占用了大部分输出预算${used}。` +
        '建议在设置里换一个非推理模型（例如 deepseek-chat），它更快、更省，也不会截断。'
    )
  } else {
    parts.push('建议在设置里把「最大输出长度」调大一些，再重新整理一次。')
  }

  return parts.join('')
}

/** 结果为空时的提示 */
export function buildEmptyResultMessage(info: DoneInfo): string {
  if (info.sawReasoning) {
    return (
      '这是个推理模型，本次输出被思考过程占满了，没有正文。原文保持不变。' +
      '建议在设置里换一个非推理模型（例如 deepseek-chat），或者在设置里把「最大输出长度」调大。'
    )
  }
  return '整理没有返回内容，原文保持不变。请再试一次。'
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
  cancel: () => void
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
              text: '当前模型带有推理过程，消耗会明显增加。'
            })
            break

          case 'privacy-notice':
            setNotice({
              kind: 'info',
              text: '你的意图文本、资料清单和语料标题会发送给该服务商。'
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
              : '请求失败'
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
        setNotice({ kind: 'warning', text: `调用失败：${text}` })
        options.onError?.(text)
        return null
      }
    },
    []
  )

  const cancel = useCallback((): void => {
    // 先立起标志，这样随后可能到达的 done 事件不会生效
    cancelledRef.current = true

    const id = requestIdRef.current
    if (id) {
      void window.preface.cancelLlm(id)
      requestIdRef.current = null
    }
    // 立刻清掉流式预览，界面马上回到可编辑状态
    setState({ running: null, streamText: '', usage: null })
    useStore.getState().setNotice({ kind: 'info', text: '已取消。' })
  }, [])

  return { state, run, cancel }
}

/** 整理结果丢了命令时，等用户决定要不要覆盖 */
export interface PendingCommandReplace {
  original: string
  cleaned: string
  missing: string[]
}

/** 整理碎碎念：把结果替换原文，并记下原文以便撤销 */
export function useTidy(): {
  tidy: () => Promise<void>
  undo: () => void
  canUndo: boolean
  running: boolean
  streamText: string
  cancel: () => void
  /** 整理结果缺少 /命令，等用户确认 */
  pendingCommand: PendingCommandReplace | null
  /** 仍然替换原文 */
  confirmReplace: () => void
  /** 保留原文 */
  cancelReplace: () => void
} {
  const { state, run, cancel } = useLlmRun()
  const [undoText, setUndoText] = useState<string | null>(null)
  const [pendingCommand, setPendingCommand] = useState<PendingCommandReplace | null>(null)

  const tidy = useCallback(async (): Promise<void> => {
    const store = useStore.getState()
    const original = store.draft.intentText
    if (!original.trim()) return

    const settings = await window.preface.getSettings()
    const stylesData = await window.preface.listStyles()
    const overrides = toOverrides(stylesData.items)

    const messages = buildTidyMessages(original, {
      styleId: store.draft.styleId,
      includeStyleSamples: settings.tidyUseStyleSamples,
      overrides
    })

    await run('tidy', messages, {
      sourceText: original,
      onDone: (text, info) => {
        // 简单模式兜底：去掉可能残留的 Markdown 符号
        const cleaned = stripMarkdown(text).trim()

        // 【重要】结果是空的就绝不覆盖原文。
        // 否则一旦上游出问题（例如事件没收到），用户的原文就被清空了。
        if (!cleaned) {
          store.setNotice({
            kind: 'warning',
            text: buildEmptyResultMessage(info)
          })
          return
        }

        /*
         * 整理会直接覆盖原文。如果结果丢了 /命令，覆盖后再提示就晚了
         * —— 所以先停下来问一句。仍然不额外调用模型。
         */
        const missing = missingCommands(original, cleaned)
        if (missing.length > 0) {
          setPendingCommand({ original, cleaned, missing })
          return
        }

        setUndoText(original)
        store.setIntentText(cleaned)

        // 输出被截断时，结果虽然能用，但要提醒用户它不完整
        if (info.truncated) {
          store.setNotice({
            kind: 'warning',
            text: buildTruncatedMessage(info)
          })
          return
        }

        store.setNotice({
          kind: 'success',
          text: '已整理。可以点「撤销整理」恢复原文。'
        })
      }
    })
    // 失败或取消时什么都不做，原文保持不变
  }, [run])

  const undo = useCallback((): void => {
    if (undoText === null) return
    const store = useStore.getState()
    store.setIntentText(undoText)
    setUndoText(null)
    store.setNotice({ kind: 'info', text: '已撤销整理。' })
  }, [undoText])

  /** 用户确认：即使少了命令也替换 */
  const confirmReplace = useCallback((): void => {
    if (!pendingCommand) return
    const store = useStore.getState()
    setUndoText(pendingCommand.original)
    store.setIntentText(pendingCommand.cleaned)
    store.setNotice({
      kind: 'warning',
      text: `已替换原文，但 ${pendingCommand.missing.join('、')} 没有保留，可以点「撤销整理」恢复原文。`
    })
    setPendingCommand(null)
  }, [pendingCommand])

  /** 用户放弃：保留原文 */
  const cancelReplace = useCallback((): void => {
    setPendingCommand(null)
    useStore.getState().setNotice({ kind: 'info', text: '已保留原文。' })
  }, [])

  return {
    tidy,
    undo,
    canUndo: undoText !== null,
    running: state.running !== null,
    streamText: state.streamText,
    cancel,
    pendingCommand,
    confirmReplace,
    cancelReplace
  }
}
