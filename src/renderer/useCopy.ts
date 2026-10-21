import { useCallback, useState } from 'react'
import { useStore } from './store'
import { assemblePrompt } from '../shared/assemble'
import { preCopyCheck, type PreCopyIssue } from '../shared/preCopyCheck'
import { useT, useUiLanguage } from './i18n'
import { formatNumber } from './format'
import type { FileResource } from '../shared/types'

interface CopyState {
  issues: PreCopyIssue[]
  /** 校验通过或用户确认后要复制的文件清单 */
  pendingUploads: FileResource[]
  showUploadList: boolean
}

/**
 * 一键复制的完整流程：
 * 检查 → （有问题时确认）→ 组装 → 写入剪贴板 → （网页端）弹出上传清单
 */
export function useCopy(): {
  copy: () => Promise<void>
  copyState: CopyState
  confirmCopy: (includeUnreferenced: boolean) => Promise<void>
  cancelCopy: () => void
  closeUploadList: () => void
} {
  const t = useT()
  const language = useUiLanguage()
  const separator = language === 'en' ? ', ' : '、'
  const [copyState, setCopyState] = useState<CopyState>({
    issues: [],
    pendingUploads: [],
    showUploadList: false
  })

  /** 组装并写剪贴板 */
  const doCopy = useCallback(
    async (excluded: Set<string>) => {
      const state = useStore.getState()
      const { draft, activeTab } = state

      // 复制的是当前显示的那个标签页
      const body = activeTab === 'result' ? (draft.result?.text ?? '') : draft.intentText

      const settings = await window.preface.getSettings()
      const result = assemblePrompt({
        files: draft.files,
        corpora: draft.corpora,
        body,
        target: draft.target,
        lengthWarnThreshold: settings.lengthWarnThreshold,
        excluded
      })

      await window.preface.writeClipboard(result.text)

      // 标记为已复制，并另存为 previous
      const copied = { ...draft, status: 'copied' as const, updatedAt: Date.now() }
      state.setDraft(copied)
      await window.preface.archiveDraft(copied)

      // 存一份历史快照，供"找回之前的内容"使用
      await window.preface.saveSnapshot(copied, 'copied')

      // 提示条
      const fileCount = draft.files.filter((f) => !excluded.has(f.id)).length
      const corpusCount = draft.corpora.filter((c) => !excluded.has(c.id)).length
      const parts: string[] = []
      if (fileCount > 0) {
        parts.push(
          fileCount === 1
            ? t('copy.filesOne')
            : t('copy.filesMany', { count: formatNumber(fileCount, language) })
        )
      }
      if (corpusCount > 0) {
        parts.push(
          corpusCount === 1
            ? t('copy.corporaOne')
            : t('copy.corporaMany', { count: formatNumber(corpusCount, language) })
        )
      }
      state.setNotice({
        kind: 'success',
        text:
          parts.length > 0
            ? t('copy.doneWith', { items: parts.join(separator) })
            : t('copy.done')
      })

      // 网页端：弹出"还需要上传的文件"清单
      if (draft.target === 'web' && result.uploads.length > 0) {
        setCopyState({
          issues: [],
          pendingUploads: result.uploads,
          showUploadList: true
        })
      }
    },
    [language, separator, t]
  )

  /** 第一步：检查 */
  const copy = useCallback(async () => {
    const state = useStore.getState()
    const { draft, activeTab } = state

    const body = activeTab === 'result' ? (draft.result?.text ?? '') : draft.intentText
    if (!body.trim()) {
      state.setNotice({ kind: 'warning', text: t('copy.empty') })
      return
    }

    // 检查文件是否还在
    const stats = await window.preface.statFiles(draft.files.map((f) => f.path))
    const missingIds = new Set<string>()
    stats.forEach((stat, index) => {
      if (!stat.exists) missingIds.add(draft.files[index].id)
    })
    state.setMissingFiles(missingIds)

    const settings = await window.preface.getSettings()
    const { issues } = preCopyCheck(
      {
        files: draft.files,
        corpora: draft.corpora,
        body,
        target: draft.target,
        missingFileIds: missingIds,
        lengthWarnThreshold: settings.lengthWarnThreshold
      },
      language
    )

    if (issues.length === 0) {
      await doCopy(new Set())
      return
    }

    setCopyState({ issues, pendingUploads: [], showUploadList: false })
  }, [doCopy, t, language])

  /** 用户在确认框里选了"仍然复制" */
  const confirmCopy = useCallback(
    async (includeUnreferenced: boolean) => {
      const state = useStore.getState()
      const { draft, activeTab } = state
      const body = activeTab === 'result' ? (draft.result?.text ?? '') : draft.intentText

      const excluded = new Set<string>()
      if (!includeUnreferenced) {
        const { unreferencedIds } = preCopyCheck(
          {
            files: draft.files,
            corpora: draft.corpora,
            body,
            target: draft.target
          },
          language
        )
        for (const id of unreferencedIds) excluded.add(id)
      }

      setCopyState({ issues: [], pendingUploads: [], showUploadList: false })
      await doCopy(excluded)
    },
    [doCopy, language]
  )

  const cancelCopy = useCallback(() => {
    setCopyState({ issues: [], pendingUploads: [], showUploadList: false })
  }, [])

  const closeUploadList = useCallback(() => {
    setCopyState((prev) => ({ ...prev, showUploadList: false }))
  }, [])

  return { copy, copyState, confirmCopy, cancelCopy, closeUploadList }
}
