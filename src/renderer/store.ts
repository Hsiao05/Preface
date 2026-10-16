import { create } from 'zustand'
import type { CorpusResource, Draft, FileResource, Mode, ReplyFormat, Target } from '../shared/types'
import { createDraft, draftId } from '../shared/types'

interface AppState {
  draft: Draft
  /** 当前显示的标签页 */
  activeTab: 'source' | 'result'
  /** 顶栏风格下拉框 */
  styleId: string
  /** 提示条 */
  notice: { text: string; kind: 'info' | 'warning' | 'success' } | null
  /** 文件已不存在的编号，用于把标签标红 */
  missingFiles: Set<string>
  /** 上一次复制过的草稿，用于"恢复上一次的内容" */
  previous: { draft: Draft; copiedAt: number; expired: boolean } | null
  /** 草稿是否已从磁盘加载完成 */
  loaded: boolean
  /** 光标位置和当前标签页，隐藏再呼出时恢复 */
  caret: number

  // ---------- 动作 ----------
  setIntentText: (text: string) => void
  setTarget: (target: Target) => void
  setMode: (mode: Mode) => void
  setReplyFormat: (format: ReplyFormat) => void
  setStyleId: (styleId: string) => void
  setActiveTab: (tab: 'source' | 'result') => void
  setNotice: (notice: AppState['notice']) => void
  setCaret: (caret: number) => void

  addFiles: (files: FileResource[], nextNo: number) => void
  removeFile: (id: string) => void
  updateFile: (id: string, patch: Partial<FileResource>) => void

  addCorpus: (corpus: CorpusResource, nextNo: number) => void
  removeCorpus: (id: string) => void
  updateCorpus: (id: string, patch: Partial<CorpusResource>) => void

  setMissingFiles: (ids: Set<string>) => void
  setDraft: (draft: Draft) => void
  /** 编辑优化结果 */
  setResultText: (text: string) => void
  /** 把结果标记为已过期（原文改过之后） */
  markResultStale: () => void
  resetDraft: () => void
  /** 清空草稿内容，保留用户的选择 */
  clearDraft: () => void
  setPrevious: (previous: AppState['previous']) => void
  setLoaded: (loaded: boolean) => void
}

/** 更新草稿并打上时间戳 */
function touch(draft: Draft, patch: Partial<Draft>): Draft {
  return { ...draft, ...patch, updatedAt: Date.now() }
}

export const useStore = create<AppState>((set) => ({
  draft: createDraft(draftId()),
  activeTab: 'source',
  styleId: 'clear-direct',
  notice: null,
  missingFiles: new Set<string>(),
  previous: null,
  loaded: false,
  caret: 0,

  setIntentText: (intentText) =>
    set((state) => {
      const draft = touch(state.draft, { intentText })
      // 原文改了，已有结果就标记为可能过期
      if (draft.result && !draft.result.stale && draft.result.text) {
        draft.result = { ...draft.result, stale: true }
      }
      return { draft }
    }),

  setTarget: (target) => set((state) => ({ draft: touch(state.draft, { target }) })),

  setMode: (mode) => set((state) => ({ draft: touch(state.draft, { mode }) })),

  setReplyFormat: (replyFormat) =>
    set((state) => ({ draft: touch(state.draft, { replyFormat }) })),

  setStyleId: (styleId) =>
    set((state) => ({ styleId, draft: touch(state.draft, { styleId }) })),

  setActiveTab: (activeTab) => set({ activeTab }),

  setNotice: (notice) => set({ notice }),

  setCaret: (caret) => set({ caret }),

  // ---------- 文件 ----------
  addFiles: (files, nextFileNo) =>
    set((state) => ({
      draft: touch(state.draft, {
        files: [...state.draft.files, ...files],
        nextFileNo
      })
    })),

  removeFile: (id) =>
    set((state) => ({
      draft: touch(state.draft, {
        files: state.draft.files.filter((f) => f.id !== id)
      })
    })),

  updateFile: (id, patch) =>
    set((state) => ({
      draft: touch(state.draft, {
        files: state.draft.files.map((f) => (f.id === id ? { ...f, ...patch } : f))
      })
    })),

  // ---------- 语料 ----------
  addCorpus: (corpus, nextCorpusNo) =>
    set((state) => ({
      draft: touch(state.draft, {
        corpora: [...state.draft.corpora, corpus],
        nextCorpusNo
      })
    })),

  removeCorpus: (id) =>
    set((state) => ({
      draft: touch(state.draft, {
        corpora: state.draft.corpora.filter((c) => c.id !== id)
      })
    })),

  updateCorpus: (id, patch) =>
    set((state) => ({
      draft: touch(state.draft, {
        corpora: state.draft.corpora.map((c) => (c.id === id ? { ...c, ...patch } : c))
      })
    })),

  setMissingFiles: (missingFiles) => set({ missingFiles }),

  setDraft: (draft) => set({ draft }),

  /**
   * 编辑优化结果。
   * 记下 editedByUser，这样切换模式或重新优化前能提醒用户会覆盖他的修改。
   */
  setResultText: (text) =>
    set((state) => {
      if (!state.draft.result) return state
      return {
        draft: touch(state.draft, {
          result: { ...state.draft.result, text, editedByUser: true }
        })
      }
    }),

  /** 原文改动后，把结果标记为可能过期 */
  markResultStale: () =>
    set((state) => {
      // 没有结果，或者已经标记过，就不用动
      if (!state.draft.result || state.draft.result.stale) return state
      return {
        draft: touch(state.draft, {
          result: { ...state.draft.result, stale: true }
        })
      }
    }),

  resetDraft: () =>
    set({
      draft: createDraft(draftId()),
      activeTab: 'source',
      missingFiles: new Set<string>(),
      caret: 0
    }),

  /**
   * 一键清空：清掉草稿内容，但保留用户的选择和偏好。
   *
   * 清掉：原文、文件和语料、优化结果、澄清问答、对话记录
   * 保留：目标、模式、风格、回复格式要求（这些属于"选择"，不是草稿内容）
   */
  clearDraft: () =>
    set((state) => {
      const fresh = createDraft(state.draft.id)
      return {
        draft: {
          ...fresh,
          // 这些选择沿用当前值
          target: state.draft.target,
          mode: state.draft.mode,
          styleId: state.draft.styleId,
          replyFormat: state.draft.replyFormat
        },
        activeTab: 'source',
        missingFiles: new Set<string>(),
        caret: 0
      }
    }),

  setPrevious: (previous) => set({ previous }),

  setLoaded: (loaded) => set({ loaded })
}))
