import { useCallback, useState } from 'react'
import { useStore } from './store'
import {
  useLlmRun,
  buildEmptyResultMessage,
  buildTruncatedMessage,
  type DoneInfo
} from './useLlmRun'
import { useT } from './i18n'
import { buildExpressionMessages, buildTidyMessages } from '../shared/buildMessages'
import { toOverrides } from './usePromptOverrides'
import { stripMarkdown, stripOuterCodeFence } from '../shared/stripMarkdown'
import { missingCommands } from '../shared/commands'
import {
  findProtectedTokenIssues,
  type ProtectedTokenIssue
} from '../shared/protectedTokens'

export type TextTransformKind = 'tidy' | 'expression'

interface TextTransformUndo {
  text: string
  kind: TextTransformKind
  previousResultStale: boolean
}

export interface PendingTextReplace {
  kind: TextTransformKind
  original: string
  replacement: string
  issues: ProtectedTokenIssue[]
  doneInfo: DoneInfo
  epoch: number
}

/**
 * 整理碎碎念和优化表达共用的改写流程。
 *
 * 两者都是“用模型改写原文”：空结果/截断/命令引用缺失的保护、撤销和
 * 错误提示完全一致，区别只在提示词、清理方式和成功文案。
 */
export function useTextTransform(): {
  runningKind: TextTransformKind | null
  tidy: () => Promise<void>
  improve: () => Promise<void>
  cancel: () => void
  undo: () => void
  canUndo: boolean
  undoKind: TextTransformKind | null
  streamText: string
  pending: PendingTextReplace | null
  confirmReplace: () => void
  cancelReplace: () => void
  clearUndo: () => void
} {
  const t = useT()
  const language = useStore((s) => s.uiLanguage)
  const { state, run, cancel } = useLlmRun()
  const [undo, setUndoState] = useState<TextTransformUndo | null>(null)
  const [pending, setPending] = useState<PendingTextReplace | null>(null)

  const separator = language === 'en' ? ', ' : '、'

  const apply = useCallback(
    (
      kind: TextTransformKind,
      original: string,
      replacement: string,
      issues: ProtectedTokenIssue[],
      doneInfo: DoneInfo
    ): void => {
      const store = useStore.getState()
      const previousResultStale = store.draft.result?.stale ?? false
      store.setIntentText(replacement)
      setUndoState({ text: original, kind, previousResultStale })

      if (issues.length > 0) {
        const tokens = issues.flatMap((issue) => issue.tokens).join(separator)
        store.setNotice({
          kind: 'warning',
          text: t(kind === 'tidy' ? 'notice.tidyProtected' : 'notice.improveProtected', {
            tokens
          })
        })
        return
      }

      if (kind === 'tidy' && doneInfo.truncated) {
        store.setNotice({
          kind: 'warning',
          text: buildTruncatedMessage(doneInfo, language)
        })
        return
      }
      store.setNotice({
        kind: 'success',
        text: t(kind === 'tidy' ? 'notice.tidyDone' : 'notice.improveDone')
      })
    },
    [separator, t]
  )

  const runTransform = useCallback(
    async (kind: TextTransformKind): Promise<void> => {
      const store = useStore.getState()
      const original = store.draft.intentText
      if (!original.trim()) return

      const epoch = store.draftEpoch
      setUndoState(null)
      setPending(null)

      const settings = await window.preface.getSettings()
      const stylesData = await window.preface.listStyles()
      const overrides = toOverrides(stylesData.items)

      const messages =
        kind === 'tidy'
          ? buildTidyMessages(original, {
              styleId: store.draft.styleId,
              includeStyleSamples: settings.tidyUseStyleSamples,
              overrides
            })
          : buildExpressionMessages(original, { overrides })

      const doneRef: { value: DoneInfo | null } = { value: null }
      const text = await run(kind, messages, {
        sourceText: original,
        trackStream: kind === 'tidy',
        onDone: (_result, done) => {
          doneRef.value = done
        }
      })
      if (text === null || doneRef.value === null) return

      const latest = useStore.getState()
      if (latest.draftEpoch !== epoch || latest.draft.intentText !== original) {
        latest.setNotice({
          kind: 'info',
          text: t('notice.improveChanged')
        })
        return
      }

      const doneInfo = doneRef.value
      const cleaned =
        kind === 'tidy'
          ? stripMarkdown(text).trim()
          : stripOuterCodeFence(text).trim()

      if (!cleaned) {
        latest.setNotice({
          kind: 'warning',
          text:
            kind === 'tidy'
              ? buildEmptyResultMessage(doneInfo, language)
              : t('notice.improveEmpty')
        })
        return
      }

      if (kind === 'expression' && doneInfo.truncated) {
        latest.setNotice({ kind: 'warning', text: t('notice.improveTruncated') })
        return
      }

      const issues: ProtectedTokenIssue[] =
        kind === 'tidy'
          ? missingCommands(original, cleaned).map((token) => ({
              kind: 'missing-command' as const,
              tokens: [token]
            }))
          : findProtectedTokenIssues(original, cleaned)

      if (issues.length > 0) {
        setPending({
          kind,
          original,
          replacement: cleaned,
          issues,
          doneInfo,
          epoch
        })
        return
      }

      apply(kind, original, cleaned, [], doneInfo)
    },
    [apply, run, t, language]
  )

  const tidy = useCallback((): Promise<void> => runTransform('tidy'), [runTransform])
  const improve = useCallback((): Promise<void> => runTransform('expression'), [runTransform])

  const undoNow = useCallback((): void => {
    if (!undo) return
    const store = useStore.getState()
    store.restoreIntentText(undo.text, undo.previousResultStale)
    setUndoState(null)
    store.setNotice({
      kind: 'info',
      text: t(undo.kind === 'tidy' ? 'notice.tidyUndone' : 'notice.improveUndone')
    })
  }, [t, undo])

  const confirmReplace = useCallback((): void => {
    if (!pending) return
    const store = useStore.getState()
    if (store.draftEpoch !== pending.epoch || store.draft.intentText !== pending.original) {
      setPending(null)
      store.setNotice({ kind: 'info', text: t('notice.improveChanged') })
      return
    }

    apply(
      pending.kind,
      pending.original,
      pending.replacement,
      pending.issues,
      pending.doneInfo
    )
    setPending(null)
  }, [apply, pending, t])

  const cancelReplace = useCallback((): void => {
    setPending(null)
    useStore.getState().setNotice({ kind: 'info', text: t('notice.keptOriginal') })
  }, [t])

  const clearUndo = useCallback((): void => {
    setUndoState(null)
  }, [])

  const runningKind: TextTransformKind | null =
    state.running?.kind === 'tidy'
      ? 'tidy'
      : state.running?.kind === 'expression'
        ? 'expression'
        : null

  return {
    runningKind,
    tidy,
    improve,
    cancel,
    undo: undoNow,
    canUndo: undo !== null,
    undoKind: undo?.kind ?? null,
    streamText: state.streamText,
    pending,
    confirmReplace,
    cancelReplace,
    clearUndo
  }
}
