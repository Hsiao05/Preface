import { useCallback, useEffect, useMemo, useState } from 'react'
import { useStore } from './store'
import { useLlmRun, type DoneInfo } from './useLlmRun'
import { useT } from './i18n'
import { buildTranslateMessages } from '../shared/buildMessages'
import { toOverrides } from './usePromptOverrides'
import { stripOuterCodeFence } from '../shared/stripMarkdown'
import {
  findProtectedTokenIssues,
  type ProtectedTokenIssue
} from '../shared/protectedTokens'
import {
  sanitizeTranslationTarget,
  translationLanguageLabel
} from '../shared/translationLanguages'
import type { Draft } from '../shared/types'

export type TranslatePane = 'source' | 'result'

interface TranslateUndo {
  pane: TranslatePane
  original: string
  translated: string
  previousResult: Draft['result']
  target: string
  expiresAt: number
}

export interface PendingTranslate {
  pane: TranslatePane
  original: string
  translated: string
  target: string
  issues: ProtectedTokenIssue[]
  epoch: number
}

const UNDO_MS = 5000

/**
 * 翻译当前编辑框。
 *
 * 结果整体替换当前编辑框，按钮原位在 5 秒内变成撤销。
 * 只替换快照对应的编辑框；等待期间文字或草稿变了就丢弃结果。
 */
export function useTranslate(): {
  runningPane: TranslatePane | null
  undo: TranslateUndo | null
  secondsLeft: number
  pending: PendingTranslate | null
  target: string
  targetLabel: string
  translate: (pane: TranslatePane) => Promise<void>
  cancel: () => void
  undoNow: () => void
  clearUndo: () => void
  confirmReplace: () => void
  cancelReplace: () => void
} {
  const t = useT()
  const language = useStore((s) => s.uiLanguage)
  const { run, cancel: cancelRun } = useLlmRun()
  const [runningPane, setRunningPane] = useState<TranslatePane | null>(null)
  const [undo, setUndo] = useState<TranslateUndo | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  const [pending, setPending] = useState<PendingTranslate | null>(null)
  const [target, setTarget] = useState('en')

  // 目标语言变化只影响下一次翻译；按钮跟着设置实时更新
  useEffect(() => {
    const load = (): void => {
      void window.preface.getSettings().then((settings) => {
        setTarget(sanitizeTranslationTarget(settings.translationTarget))
      })
    }
    load()
    window.addEventListener('preface:settings-changed', load)
    return () => window.removeEventListener('preface:settings-changed', load)
  }, [])

  useEffect(() => {
    if (!undo) {
      setSecondsLeft(0)
      return
    }

    const tick = (): void => {
      const remaining = undo.expiresAt - Date.now()
      if (remaining <= 0) {
        setUndo(null)
        setSecondsLeft(0)
        return
      }
      setSecondsLeft(Math.ceil(remaining / 1000))
    }

    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
  }, [undo])

  const draftText = useStore((s) => s.draft.intentText)
  const resultText = useStore((s) => s.draft.result?.text ?? '')

  // 5 秒内用户手动改了文字，撤销就不再指向用户现在的编辑
  useEffect(() => {
    if (!undo) return
    const current = undo.pane === 'source' ? draftText : resultText
    if (current !== undo.translated) setUndo(null)
  }, [draftText, resultText, undo])

  const clearUndo = useCallback((): void => {
    setUndo(null)
  }, [])

  const apply = useCallback(
    (pane: TranslatePane, original: string, translated: string, usedTarget: string): void => {
      const store = useStore.getState()
      const previousResult = store.draft.result

      if (pane === 'source') {
        store.setIntentText(translated)
      } else {
        if (!previousResult) return
        store.setResult({ ...previousResult, text: translated, editedByUser: true })
      }

      setUndo({
        pane,
        original,
        translated,
        previousResult,
        target: usedTarget,
        expiresAt: Date.now() + UNDO_MS
      })
      store.setNotice({
        kind: 'success',
        text: t('notice.translated', {
          language: translationLanguageLabel(usedTarget, language)
        })
      })
    },
    [language, t]
  )

  const translate = useCallback(
    async (pane: TranslatePane): Promise<void> => {
      if (runningPane) return

      const store = useStore.getState()
      const source =
        pane === 'source' ? store.draft.intentText : store.draft.result?.text ?? ''
      if (!source.trim()) return

      const epoch = store.draftEpoch
      setUndo(null)
      setPending(null)
      setRunningPane(pane)

      let text: string | null = null
      try {
        const settings = await window.preface.getSettings()
        const usedTarget = sanitizeTranslationTarget(settings.translationTarget)
        const stylesData = await window.preface.listStyles()
        const overrides = toOverrides(stylesData.items)
        const doneRef: { value: DoneInfo | null } = { value: null }
        text = await run(
          'translate',
          buildTranslateMessages(source, { overrides, target: usedTarget }),
          {
            sourceText: source,
            trackStream: false,
            onDone: (_result, done) => {
              doneRef.value = done
            }
          }
        )

        const latest = useStore.getState()
        const current =
          pane === 'source'
            ? latest.draft.intentText
            : latest.draft.result?.text ?? ''

        if (text === null || doneRef.value === null) return
        if (latest.draftEpoch !== epoch) {
          latest.setNotice({ kind: 'info', text: t('notice.translateChanged') })
          return
        }
        if (current !== source) {
          latest.setNotice({ kind: 'info', text: t('notice.translateChanged') })
          return
        }

        const doneInfo: DoneInfo = doneRef.value
        if (doneInfo.truncated) {
          latest.setNotice({ kind: 'warning', text: t('notice.translateTruncated') })
          return
        }

        const translated = stripOuterCodeFence(text)
        if (!translated.trim()) {
          latest.setNotice({ kind: 'warning', text: t('notice.translateEmpty') })
          return
        }
        if (translated.trim() === source.trim()) {
          latest.setNotice({ kind: 'info', text: t('notice.translateSame') })
          return
        }

        const issues = findProtectedTokenIssues(source, translated)
        if (issues.length > 0) {
          setPending({ pane, original: source, translated, target: usedTarget, issues, epoch })
          return
        }

        apply(pane, source, translated, usedTarget)
      } finally {
        setRunningPane(null)
      }
    },
    [apply, runningPane, run, t]
  )

  const cancel = useCallback((): void => {
    cancelRun()
    setRunningPane(null)
  }, [cancelRun])

  const undoNow = useCallback((): void => {
    if (!undo) return
    const store = useStore.getState()

    if (undo.pane === 'source') {
      store.restoreIntentText(undo.original, undo.previousResult?.stale ?? false)
    } else {
      store.setResult(undo.previousResult)
    }

    setUndo(null)
    store.setNotice({ kind: 'info', text: t('notice.translateUndone') })
  }, [t, undo])

  const confirmReplace = useCallback((): void => {
    if (!pending) return
    const store = useStore.getState()
    const current =
      pending.pane === 'source'
        ? store.draft.intentText
        : store.draft.result?.text ?? ''

    if (store.draftEpoch !== pending.epoch || current !== pending.original) {
      setPending(null)
      store.setNotice({ kind: 'info', text: t('notice.translateChanged') })
      return
    }

    apply(pending.pane, pending.original, pending.translated, pending.target)
    setPending(null)
  }, [apply, pending, t])

  const cancelReplace = useCallback((): void => {
    setPending(null)
    useStore.getState().setNotice({ kind: 'info', text: t('notice.keptOriginal') })
  }, [t])

  const targetLabel = useMemo(
    () => translationLanguageLabel(target, language),
    [language, target]
  )

  return {
    runningPane,
    undo,
    secondsLeft,
    pending,
    target,
    targetLabel,
    translate,
    cancel,
    undoNow,
    clearUndo,
    confirmReplace,
    cancelReplace
  }
}
