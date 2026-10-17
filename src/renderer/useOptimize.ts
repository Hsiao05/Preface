import { useCallback, useRef, useState } from 'react'
import { useStore } from './store'
import { useLlmRun, type DoneInfo } from './useLlmRun'
import { buildOptimizeUserMessage, buildSystemPrompt } from '../shared/buildMessages'
import { detectStreamPhase, extractStreamResult, parseReply, type ParsedQuestion } from '../shared/parseReply'
import {
  buildClarifyMessage,
  buildFirstRoundMessages,
  buildFollowUpMessages,
  buildModeSwitchMessage,
  type ClarifyAnswer
} from '../shared/conversation'
import { validateRefs } from '../shared/validateRefs'
import { buildCommandWarning } from '../shared/commands'
import { toOverrides } from './usePromptOverrides'
import { stripMarkdown, stripPreamble } from '../shared/stripMarkdown'
import { formatTokenCount } from '../shared/estimateTokens'
import type { ResolvedMode } from '../shared/types'

/**
 * 一键优化的完整流程（文档第六节）。
 *
 *   首轮调用 → （需要时）澄清 → 续写 → 校验与补救 → 展示
 *
 * 关键设计：后续所有调用都接在同一段对话后面追加一条消息，
 * 前三条消息始终不变，能命中服务商的前缀缓存。
 */

export type OptimizePhase =
  | 'idle'
  | 'analyzing' // 首轮调用中，还没看到【结果】
  | 'streaming' // 正在流式接收结果
  | 'waiting-clarify' // 等用户回答澄清问题
  | 'remedying' // 引用校验没过，正在补救

export interface OptimizeState {
  phase: OptimizePhase
  /** 意图复述 */
  intent: string | null
  /** 待澄清的问题 */
  questions: ParsedQuestion[]
  /** 模型选的模式 */
  resolvedMode: ResolvedMode | null
  /** 模型没按格式输出，走了兜底 */
  fellBack: boolean
  /** 引用校验没过、补救也没成功时的提示 */
  refWarning: string | null
  /** 原文里的 /命令 没有原样保留（或结果里多出了命令）时的提示 */
  commandWarning: string | null
  /** 本次用量 */
  usage: { input: number; output: number; cached: number } | null
  /** 这次调用带了推理过程 */
  sawReasoning: boolean
}

const INITIAL: OptimizeState = {
  phase: 'idle',
  intent: null,
  questions: [],
  resolvedMode: null,
  fellBack: false,
  refWarning: null,
  commandWarning: null,
  usage: null,
  sawReasoning: false
}

/** 一次会话的上下文。后续调用都基于它。 */
interface Session {
  systemPrompt: string
  firstUserMessage: string
  firstReply: string
  followUps: Array<{ role: 'user' | 'assistant'; content: string }>
  resolvedMode: ResolvedMode | null
}

export function useOptimize(): {
  state: OptimizeState
  streamText: string
  /** 需要用户确认"将覆盖你的修改"时，这里是待执行的动作 */
  pendingConfirm: (() => void) | null
  /** 用户确认覆盖 */
  confirmOverwrite: () => void
  /** 用户取消覆盖 */
  cancelOverwrite: () => void
  optimize: () => Promise<void>
  submitAnswers: (
    answers: Record<string, ClarifyAnswer>,
    intentCorrection: string | null
  ) => Promise<void>
  switchMode: (target: 'simple' | 'markdown') => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<OptimizeState>(INITIAL)
  const [streamText, setStreamText] = useState('')
  const [pendingConfirm, setPendingConfirm] = useState<(() => void) | null>(null)
  const { run, cancel: cancelRun } = useLlmRun()
  const sessionRef = useRef<Session | null>(null)

  /**
   * 结果被用户编辑过时，动手覆盖前先确认。
   * 没编辑过就直接执行。
   */
  const guardOverwrite = useCallback((action: () => void): void => {
    const store = useStore.getState()
    if (store.draft.result?.editedByUser) {
      setPendingConfirm(() => action)
      return
    }
    action()
  }, [])

  /**
   * 跑一次调用，把流式中间态暴露给界面。
   * 返回模型的完整输出和结束信息；失败或取消时返回 null。
   */
  const callModel = useCallback(
    async (
      kind: 'optimize' | 'followup',
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      sourceText: string,
      options: { showStream: boolean }
    ): Promise<{
      text: string
      info: DoneInfo
      usage: { input: number; output: number; cached: number } | null
    } | null> => {
      let accumulated = ''
      let doneInfo: DoneInfo | null = null
      let finalText = ''
      let usage: { input: number; output: number; cached: number } | null = null

      const outcome = await run(kind, messages, {
        sourceText,
        trackStream: false,
        onUsage: (u) => {
          usage = { input: u.input ?? 0, output: u.output ?? 0, cached: u.cached ?? 0 }
        },
        onDelta: (chunk) => {
          accumulated += chunk
          if (!options.showStream) return

          // 只在看到【结果】之后才开始显示，之前显示"正在分析…"
          const phase = detectStreamPhase(accumulated)
          if (phase === 'result') {
            setStreamText(extractStreamResult(accumulated))
            setState((prev) => (prev.phase === 'streaming' ? prev : { ...prev, phase: 'streaming' }))
          } else if (phase === 'questions') {
            setState((prev) =>
              prev.phase === 'analyzing' ? { ...prev, phase: 'analyzing' } : prev
            )
          }
        },
        onDone: (text, info) => {
          finalText = text
          doneInfo = info
        }
      })

      if (outcome === null || doneInfo === null) return null
      return { text: finalText, info: doneInfo, usage }
    },
    [run]
  )

  /** 把结果写进草稿并切到结果页 */
  const commitResult = useCallback(
    (
      text: string,
      mode: ResolvedMode | null,
      usage: { input: number; output: number; cached: number } | null
    ) => {
      const store = useStore.getState()
      // 简单模式要兜底清理残留的 Markdown 符号
      const cleaned = mode === 'simple' ? stripMarkdown(stripPreamble(text)) : stripPreamble(text)

      store.setDraft({
        ...store.draft,
        result: { text: cleaned, editedByUser: false, stale: false },
        lastAction: 'optimize',
        optimization: {
          messages: [],
          intent: store.draft.intentText,
          resolvedMode: mode,
          questions: [],
          answers: {},
          intentCorrection: null,
          usage: usage ? { ...usage, estimated: false } : null
        },
        updatedAt: Date.now()
      })
      store.setActiveTab('result')
    },
    []
  )

  /** 校验引用，不过就补救一次 */
  const verifyAndRemedy = useCallback(
    async (
      text: string,
      mode: ResolvedMode | null,
      session: Session,
      sourceText: string
    ): Promise<{ text: string; warning: string | null }> => {
      const store = useStore.getState()
      const check = validateRefs({
        source: store.draft.intentText,
        result: text,
        files: store.draft.files,
        corpora: store.draft.corpora
      })

      if (check.ok) return { text, warning: null }

      // 自动补救一次（文档只允许这一次）
      setState((prev) => ({ ...prev, phase: 'remedying' }))

      const remedyTurn = { role: 'user' as const, content: check.remedyMessage }
      const messages = buildFollowUpMessages(session.systemPrompt, session, remedyTurn)

      const remedy = await callModel('followup', messages, sourceText, { showStream: false })
      if (remedy === null) {
        // 补救失败，保留原结果并提示
        return { text, warning: '引用可能有误，请检查。' }
      }

      const reparsed = parseReply(remedy.text)
      const remediedText = reparsed.result ?? remedy.text

      // 补救后的结果仍然要清理
      const cleaned = mode === 'simple' ? stripMarkdown(remediedText) : remediedText

      const recheck = validateRefs({
        source: store.draft.intentText,
        result: cleaned,
        files: store.draft.files,
        corpora: store.draft.corpora
      })

      // 记录这次补救，后续调用能看到
      session.followUps.push(remedyTurn, { role: 'assistant', content: remedy.text })

      if (recheck.ok) {
        return { text: cleaned, warning: null }
      }
      return { text: cleaned, warning: '引用可能有误，请检查。' }
    },
    [callModel]
  )

  /** 处理模型输出（首轮和续写共用） */
  const handleReply = useCallback(
    async (
      raw: string,
      info: DoneInfo,
      isFirstRound: boolean,
      usage: { input: number; output: number; cached: number } | null
    ): Promise<void> => {
      const parsed = parseReply(raw)
      const session = sessionRef.current

      if (session && isFirstRound) {
        session.firstReply = raw
        session.resolvedMode = parsed.mode
      }

      // 把模型起的标题写回资料（文档第六节：解析后立即写回）
      applyTitles(parsed.titles)

      setState((prev) => ({
        ...prev,
        intent: parsed.intent ?? prev.intent,
        resolvedMode: parsed.mode ?? prev.resolvedMode,
        sawReasoning: info.sawReasoning,
        fellBack: parsed.fellBack,
        usage
      }))

      // 有结果：走校验 → 展示
      if (parsed.result !== null && parsed.questions.length === 0) {
        const mode = parsed.mode ?? session?.resolvedMode ?? null
        const store = useStore.getState()
        const sourceText = store.draft.intentText

        const { text, warning } = session
          ? await verifyAndRemedy(parsed.result, mode, session, sourceText)
          : { text: parsed.result, warning: null }

        commitResult(text, mode, usage)
        // 拿到结果了，兜底计数清零
        clearFallback()
        setState((prev) => ({
          ...prev,
          phase: 'idle',
          refWarning: warning,
          // 只比对、只提示，不额外调用模型
          commandWarning: buildCommandWarning(sourceText, text),
          questions: []
        }))
        setStreamText('')
        return
      }

      // 有提问：等用户回答
      if (parsed.questions.length > 0) {
        setState((prev) => ({
          ...prev,
          phase: 'waiting-clarify',
          questions: parsed.questions,
          intent: parsed.intent
        }))
        setStreamText('')
        return
      }

      // 兜底：既没结果也没问题
      setState((prev) => ({ ...prev, phase: 'idle', fellBack: true }))
      setStreamText('')
      void reportFallback()
    },
    [commitResult, verifyAndRemedy]
  )

  /**
   * 把模型起的语料标题写回草稿。
   *
   * 【只改未命名的】用户自己填过的标题不能被覆盖。
   * 标题一旦写回，下次优化时就不再发送那段摘录了。
   */
  const applyTitles = useCallback((titles: Record<string, string>) => {
    const entries = Object.entries(titles)
    if (entries.length === 0) return

    const store = useStore.getState()
    let changed = false

    const corpora = store.draft.corpora.map((corpus) => {
      const newTitle = titles[corpus.id]
      if (!newTitle) return corpus

      // 用户自己命名的语料不覆盖
      if (corpus.titleSource === 'user' && corpus.title.trim()) return corpus
      if (corpus.title.trim() === newTitle.trim()) return corpus

      changed = true
      return {
        ...corpus,
        title: newTitle.trim().slice(0, 20), // 文档要求超过 20 字时截断
        titleSource: 'ai' as const
      }
    })

    if (changed) {
      store.setDraft({ ...store.draft, corpora, updatedAt: Date.now() })
    }
  }, [])

  /**
   * 记录一次兜底。
   *
   * 用户改过提示词、又连续两次兜底时，提示他检查提示词或恢复默认。
   * 这是文档第八节的"改坏了的保护"。
   */
  const reportFallback = useCallback(async (): Promise<void> => {
    const store = useStore.getState()
    const streak = store.draft.fallbackStreak + 1

    store.setDraft({ ...store.draft, fallbackStreak: streak, updatedAt: Date.now() })

    if (streak < 2) return

    // 看看用户有没有改过优化提示词
    const data = await window.preface.listStyles()
    const editedPrompt = data.items.some(
      (i) => (i.kind === 'block' || i.kind === 'template') && i.edited
    )

    if (editedPrompt) {
      store.setNotice({
        kind: 'warning',
        text: '模型连续两次没有按格式输出。你改过提示词，建议检查一下修改，或在「设置 → 提示词与风格」里恢复默认。'
      })
    }
  }, [])

  /** 成功拿到结果时，把兜底计数清零 */
  const clearFallback = useCallback((): void => {
    const store = useStore.getState()
    if (store.draft.fallbackStreak === 0) return
    store.setDraft({ ...store.draft, fallbackStreak: 0 })
  }, [])

  /** 开始一次优化 */
  const runOptimize = useCallback(async () => {
    const store = useStore.getState()
    const draft = store.draft
    if (!draft.intentText.trim()) return

    const settings = await window.preface.getSettings()
    // 读用户改过的提示词（没改过的用内置版本）
    const stylesData = await window.preface.listStyles()
    const overrides = toOverrides(stylesData.items)

    const systemPrompt = buildSystemPrompt({
      styleId: draft.styleId,
      maxQuestions: settings.maxQuestions,
      overrides
    })
    const firstUserMessage = buildOptimizeUserMessage({
      mode: draft.mode,
      replyFormat: draft.replyFormat,
      files: draft.files,
      corpora: draft.corpora,
      intentText: draft.intentText,
      maxQuestions: settings.maxQuestions,
      corpusInfo: settings.corpusInfo
    })

    sessionRef.current = {
      systemPrompt,
      firstUserMessage,
      firstReply: '',
      followUps: [],
      resolvedMode: null
    }

    setState({ ...INITIAL, phase: 'analyzing' })
    setStreamText('')

    // 【重要】立刻切到"优化结果"标签页。
    // 否则流式内容会显示在原文页上，看起来像把原文改掉了。
    useStore.getState().setActiveTab('result')

    const result = await callModel(
      'optimize',
      buildFirstRoundMessages(systemPrompt, firstUserMessage),
      draft.intentText,
      { showStream: true }
    )

    if (result === null) {
      // 失败或取消
      setState((prev) => ({ ...prev, phase: 'idle' }))
      setStreamText('')
      return
    }

    await handleReply(result.text, result.info, true, result.usage)
  }, [callModel, handleReply])

  /** 开始优化。结果被编辑过时先问一句。 */
  const optimize = useCallback(async () => {
    guardOverwrite(() => {
      void runOptimize()
    })
  }, [guardOverwrite, runOptimize])

  /** 用户回答完澄清问题（或点了"跳过"）后继续 */
  const submitAnswers = useCallback(
    async (answers: Record<string, ClarifyAnswer>, intentCorrection: string | null) => {
      const session = sessionRef.current
      if (!session) return

      const store = useStore.getState()
      const sourceText = store.draft.intentText

      // 把答案组装成澄清消息
      const clarifyTurn = {
        role: 'user' as const,
        content: buildClarifyMessage({
          firstUserMessage: session.firstUserMessage,
          firstReply: session.firstReply,
          parsed: parseReply(session.firstReply),
          answers,
          intentCorrection,
          followUps: []
        })
      }

      session.followUps.push(clarifyTurn)

      setState((prev) => ({ ...prev, phase: 'analyzing', questions: [] }))
      setStreamText('')
      useStore.getState().setActiveTab('result')

      const messages = buildFollowUpMessages(session.systemPrompt, session, clarifyTurn)
      const result = await callModel('followup', messages, sourceText, { showStream: true })

      if (result === null) {
        setState((prev) => ({ ...prev, phase: 'idle' }))
        setStreamText('')
        return
      }

      session.followUps.push({ role: 'assistant', content: result.text })
      await handleReply(result.text, result.info, false, result.usage)
    },
    [callModel, handleReply]
  )

  /** 切换模式：在当前对话后面追加一条消息 */
  const runSwitchMode = useCallback(
    async (target: 'simple' | 'markdown') => {
      const session = sessionRef.current
      if (!session) return

      const store = useStore.getState()
      const sourceText = store.draft.intentText

      const turn = { role: 'user' as const, content: buildModeSwitchMessage(target) }
      session.followUps.push(turn)
      session.resolvedMode = target

      setState((prev) => ({ ...prev, phase: 'analyzing' }))
      setStreamText('')
      useStore.getState().setActiveTab('result')

      const messages = buildFollowUpMessages(session.systemPrompt, session, turn)
      const result = await callModel('followup', messages, sourceText, { showStream: true })

      if (result === null) {
        setState((prev) => ({ ...prev, phase: 'idle' }))
        setStreamText('')
        return
      }

      session.followUps.push({ role: 'assistant', content: result.text })

      const parsed = parseReply(result.text)
      const text = parsed.result ?? result.text
      const cleaned = target === 'simple' ? stripMarkdown(text) : text

      commitResult(cleaned, target, result.usage)
      setState((prev) => ({
        ...prev,
        phase: 'idle',
        resolvedMode: target,
        commandWarning: buildCommandWarning(sourceText, cleaned)
      }))
      setStreamText('')
    },
    [callModel, commitResult]
  )

  /** 切换模式。结果被编辑过时先问一句。 */
  const switchMode = useCallback(
    async (target: 'simple' | 'markdown') => {
      guardOverwrite(() => {
        void runSwitchMode(target)
      })
    },
    [guardOverwrite, runSwitchMode]
  )

  const cancel = useCallback(() => {
    cancelRun()
    setState((prev) => ({ ...prev, phase: 'idle' }))
    setStreamText('')
  }, [cancelRun])

  const reset = useCallback(() => {
    setState(INITIAL)
    setStreamText('')
  }, [])

  return {
    state,
    streamText,
    pendingConfirm,
    confirmOverwrite: () => {
      const action = pendingConfirm
      setPendingConfirm(null)
      action?.()
    },
    cancelOverwrite: () => setPendingConfirm(null),
    optimize,
    submitAnswers,
    switchMode,
    cancel,
    reset
  }
}

export { formatTokenCount }
