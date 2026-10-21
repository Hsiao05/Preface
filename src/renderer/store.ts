import { create } from 'zustand'
import type { CorpusResource, Draft, FileResource, Mode, ReplyFormat, Target } from '../shared/types'
import { createDraft, draftId } from '../shared/types'
import type { PromptSelection } from '../shared/promptLibrary'
import type { UiLanguage } from '../shared/i18n'
import { appendWithSpacing } from '../shared/appendText'

interface AppState {
  draft: Draft
  /** 界面语言。启动时由 localStorage 镜像先填入，随后用设置校正。 */
  uiLanguage: UiLanguage
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
  /**
   * 草稿代数。清空、重置、恢复历史时 +1。
   * 优化会话记下开始时的代数，草稿换了之后旧会话不能接着用。
   */
  draftEpoch: number
  /** 草稿是否已从磁盘加载完成 */
  loaded: boolean
  /** 光标位置和当前标签页，隐藏再呼出时恢复 */
  caret: number
  /**
   * 当前这一轮优化实际用的 Prompt 快照。
   *
   * 和 draft.promptSelection（下一次要用什么）分开：已经开始的澄清、补救、
   * 模式切换必须沿用开始时的那一份，用户中途换了选择只影响下一次优化。
   */
  activePrompt: PromptSelection | null

  // ---------- 动作 ----------
  setUiLanguage: (language: UiLanguage) => void
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

  /** 设置下一次优化要用的 Prompt（null 表示不用） */
  setPromptSelection: (selection: PromptSelection | null) => void
  /** 记录本轮优化实际用的快照 */
  setActivePrompt: (selection: PromptSelection | null) => void
  /**
   * 往原文末尾追加文字（Prompt 库的「追加到原文」）。
   * 与 setIntentText 的区别：已复制的草稿要回到 editing，
   * 否则下次呼出会直接换成新草稿，刚追加的内容就丢了。
   */
  appendIntentText: (addition: string) => void

  setMissingFiles: (ids: Set<string>) => void
  setDraft: (draft: Draft) => void
  /**
   * 换一张草稿（加载、恢复历史、撤销清空、换新）。
   *
   * 和 setDraft 的区别：草稿代数 +1，进行中的优化会话随之作废。
   * 优化流程自己写回结果时用 setDraft，不能把当前会话踢掉。
   */
  replaceDraft: (draft: Draft) => void
  /** 编辑优化结果 */
  setResultText: (text: string) => void
  /** 精确替换结果对象（翻译用，保留 editedByUser/stale 的原始语义） */
  setResult: (result: Draft['result']) => void
  /** 撤销原文改写，并把结果的过期标记恢复到改写前 */
  restoreIntentText: (text: string, resultStale: boolean) => void
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

/** 读取界面语言的本地镜像，避免设置加载前先闪一帧中文 */
export function initialUiLanguage(): UiLanguage {
  try {
    const value = window.localStorage.getItem('preface.uiLanguage')
    return value === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export const useStore = create<AppState>((set) => ({
  draft: createDraft(draftId()),
  uiLanguage: initialUiLanguage(),
  activeTab: 'source',
  styleId: 'clear-direct',
  notice: null,
  missingFiles: new Set<string>(),
  previous: null,
  loaded: false,
  caret: 0,
  activePrompt: null,
  draftEpoch: 0,

  setUiLanguage: (uiLanguage) => {
    try {
      window.localStorage.setItem('preface.uiLanguage', uiLanguage)
    } catch {
      // 隐私模式或存储被禁时只影响下次启动的首帧，不影响本次切换
    }
    set({ uiLanguage })
  },

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

  // ---------- Prompt 库 ----------
  setPromptSelection: (promptSelection) =>
    set((state) => ({ draft: touch(state.draft, { promptSelection }) })),

  setActivePrompt: (activePrompt) => set({ activePrompt }),

  appendIntentText: (addition) =>
    set((state) => {
      const intentText = appendWithSpacing(state.draft.intentText, addition)
      if (intentText === state.draft.intentText) return state

      const draft = touch(state.draft, {
        intentText,
        // 已复制的草稿追加了内容，就回到编辑中
        status: 'editing'
      })
      if (draft.result && !draft.result.stale && draft.result.text) {
        draft.result = { ...draft.result, stale: true }
      }
      return { draft }
    }),

  setMissingFiles: (missingFiles) => set({ missingFiles }),

  setDraft: (draft) => set({ draft }),

  replaceDraft: (draft) =>
    set((state) => ({
      draft,
      draftEpoch: state.draftEpoch + 1,
      // 换了一张草稿，上一轮的 Prompt 快照不能再显示成"本轮"
      activePrompt: null
    })),

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

  /** 精确写回整个结果对象，不额外修改 editedByUser */
  setResult: (result) =>
    set((state) => ({
      draft: touch(state.draft, { result })
    })),

  /** 撤销改写：写入原文，并把结果的过期标记恢复到操作前 */
  restoreIntentText: (text, resultStale) =>
    set((state) => {
      const result = state.draft.result
        ? { ...state.draft.result, stale: resultStale }
        : null
      return { draft: touch(state.draft, { intentText: text, result }) }
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
    set((state) => ({
      draft: createDraft(draftId()),
      activeTab: 'source',
      missingFiles: new Set<string>(),
      caret: 0,
      // 新草稿没有选择，上一轮用的 Prompt 也不能带过来
      activePrompt: null,
      draftEpoch: state.draftEpoch + 1
    })),

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
          // 【注意】promptSelection 属于草稿内容，清空时不保留
        },
        activeTab: 'source',
        missingFiles: new Set<string>(),
        caret: 0,
        activePrompt: null,
        draftEpoch: state.draftEpoch + 1
      }
    }),

  setPrevious: (previous) => set({ previous }),

  setLoaded: (loaded) => set({ loaded })
}))
