import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { Draft, FileResource } from '../shared/types'
import type { UsageInfo } from '../shared/sse'
import type { LlmError } from '../shared/llmErrors'
import type { CallKind } from '../main/llm'
import type { SpeechConfig } from '../shared/speech'

/** 订阅主进程事件，返回取消订阅的函数 */
function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** 流式事件 */
export interface LlmStreamEvent {
  type: 'delta' | 'usage' | 'reasoning' | 'privacy-notice' | 'done' | 'error'
  text?: string
  usage?: UsageInfo
  error?: LlmError
  /** 这次调用里模型输出了思考内容 */
  sawReasoning?: boolean
  /** 输出被 max_tokens 上限截断了 */
  truncated?: boolean
  /** 推理过程用掉的 token 数 */
  reasoningTokens?: number
}

/** 提示词与风格的一项 */
export interface StyleItemView {
  id: string
  kind: 'block' | 'template' | 'style' | 'extra'
  name: string
  builtin: boolean
  builtinVersion: number
  edited: boolean
  text: string
  samples?: string[]
  /** 内置版本有更新（用户改过，且内置内容升级了） */
  hasBuiltinUpdate?: boolean
}

/** 一份草稿快照的摘要，用于"找回之前的内容"列表 */
export interface SnapshotSummary {
  id: string
  savedAt: number
  reason: 'copied' | 'cleared' | 'manual'
  preview: string
  fileCount: number
  corpusCount: number
  hasResult: boolean
  intentChars: number
}

/** 界面能看到的配置信息（不含 Key） */
export interface ProfileView {
  id: string
  name: string
  format: 'openai' | 'anthropic'
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  privacyNoticeShown: boolean
  hasKey: boolean
}

export interface ProfilesView {
  currentId: string | null
  profiles: ProfileView[]
}

const api = {
  // ---------- 设置 ----------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),

  // ---------- 窗口 ----------
  hideWindow: () => ipcRenderer.invoke('window:hide'),

  // ---------- 应用 ----------
  getVersion: () => ipcRenderer.invoke('app:version'),
  getLogPath: () => ipcRenderer.invoke('window:get-log-path'),
  shortcutLabel: (accelerator: string) => ipcRenderer.invoke('app:shortcut-label', accelerator),

  // ---------- 草稿 ----------
  loadDraft: () => ipcRenderer.invoke('draft:load') as Promise<Draft | null>,
  saveDraft: (draft: Draft) => ipcRenderer.invoke('draft:save', draft) as Promise<boolean>,
  archiveDraft: (draft: Draft) => ipcRenderer.invoke('draft:archive', draft) as Promise<boolean>,
  loadPreviousDraft: () =>
    ipcRenderer.invoke('draft:load-previous') as Promise<{
      draft: Draft
      copiedAt: number
      expired: boolean
    } | null>,
  clearPreviousDraft: () => ipcRenderer.invoke('draft:clear-previous') as Promise<boolean>,

  // ---------- 草稿历史（"找回之前的内容"）----------
  saveSnapshot: (draft: Draft, reason: 'copied' | 'cleared' | 'manual') =>
    ipcRenderer.invoke('history:save', draft, reason) as Promise<boolean>,
  listSnapshots: () => ipcRenderer.invoke('history:list') as Promise<SnapshotSummary[]>,
  loadSnapshot: (id: string) => ipcRenderer.invoke('history:load', id) as Promise<Draft | null>,
  deleteSnapshot: (id: string) => ipcRenderer.invoke('history:delete', id) as Promise<boolean>,
  clearAllSnapshots: () => ipcRenderer.invoke('history:clear-all') as Promise<number>,

  // ---------- 文件 ----------
  pickFiles: () => ipcRenderer.invoke('files:pick') as Promise<string[]>,

  /**
   * 从拖入的 File 对象取真实路径。
   * Electron 32 之后 File.path 被移除，必须用 webUtils.getPathForFile。
   */
  getPathForFile: (file: File) => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  addFiles: (
    paths: string[],
    existing: FileResource[],
    intentText: string,
    nextNo: number
  ) =>
    ipcRenderer.invoke('files:add', paths, existing, intentText, nextNo) as Promise<{
      added: FileResource[]
      nextNo: number
      skipped: string[]
    }>,

  statFiles: (paths: string[]) =>
    ipcRenderer.invoke('files:stat', paths) as Promise<
      Array<{ path: string; exists: boolean; name?: string; size?: number; mtime?: number }>
    >,

  showInFolder: (path: string) => ipcRenderer.invoke('files:show-in-folder', path),
  startDrag: (paths: string[]) => ipcRenderer.invoke('files:start-drag', paths),

  // ---------- 剪贴板 ----------
  writeClipboard: (text: string) =>
    ipcRenderer.invoke('clipboard:write', text) as Promise<boolean>,

  // ---------- 模型配置 ----------
  listProfiles: () => ipcRenderer.invoke('profiles:list') as Promise<ProfilesView>,
  saveProfile: (profile: Omit<ProfileView, 'hasKey'>) =>
    ipcRenderer.invoke('profiles:save', profile) as Promise<ProfilesView>,
  deleteProfile: (id: string) => ipcRenderer.invoke('profiles:delete', id) as Promise<ProfilesView>,
  setCurrentProfile: (id: string | null) =>
    ipcRenderer.invoke('profiles:set-current', id) as Promise<ProfilesView>,

  // ---------- API Key（只能存和查，拿不到明文）----------
  setApiKey: (profileId: string, key: string) =>
    ipcRenderer.invoke('secrets:set', profileId, key) as Promise<boolean>,
  hasApiKey: (profileId: string) =>
    ipcRenderer.invoke('secrets:has', profileId) as Promise<boolean>,
  clearApiKey: (profileId: string) => ipcRenderer.invoke('secrets:clear', profileId),

  // ---------- 模型调用 ----------
  listModels: (profileId?: string) =>
    ipcRenderer.invoke('llm:list-models', profileId) as Promise<
      | { ok: true; models: Array<{ id: string; displayName?: string }> }
      | { ok: false; error: LlmError }
    >,

  testConnection: (profileId?: string) =>
    ipcRenderer.invoke('llm:test', profileId) as Promise<
      | { ok: true; elapsedMs: number; sawReasoning: boolean }
      | { ok: false; error: LlmError }
    >,

  /**
   * 发起一次模型调用。
   * 返回 requestId 和 done（调用结束时 resolve）。
   *
   * 【为什么频道由这里生成】
   * 必须先注册监听、再发起调用。反过来做的话，主进程可能在监听注册之前
   * 就把内容发完了（快模型尤其明显），界面就什么都收不到。
   */
  runLlm: async (
    kind: CallKind,
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    sourceText: string | undefined,
    onEvent: (event: LlmStreamEvent) => void
  ): Promise<{ requestId: string; done: Promise<void> }> => {
    const channel = `llm:event:${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    let resolveDone: () => void = () => {}
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    const listener = (_event: IpcRendererEvent, payload: LlmStreamEvent): void => {
      onEvent(payload)
      if (payload.type === 'done' || payload.type === 'error') {
        ipcRenderer.removeListener(channel, listener)
        resolveDone()
      }
    }

    // 先挂监听
    ipcRenderer.on(channel, listener)

    try {
      const { requestId } = (await ipcRenderer.invoke(
        'llm:run',
        kind,
        messages,
        sourceText,
        channel
      )) as { requestId: string }
      return { requestId, done }
    } catch (error) {
      ipcRenderer.removeListener(channel, listener)
      resolveDone()
      throw error
    }
  },

  cancelLlm: (requestId: string) =>
    ipcRenderer.invoke('llm:cancel', requestId) as Promise<boolean>,

  // ---------- 提示词与风格 ----------
  listStyles: () => ipcRenderer.invoke('styles:list') as Promise<{ items: StyleItemView[] }>,
  saveStyle: (item: StyleItemView) =>
    ipcRenderer.invoke('styles:save', item) as Promise<{ items: StyleItemView[] }>,
  resetStyle: (id: string) =>
    ipcRenderer.invoke('styles:reset', id) as Promise<{ items: StyleItemView[] }>,
  deleteStyle: (id: string) =>
    ipcRenderer.invoke('styles:delete', id) as Promise<{
      ok: boolean
      styles: { items: StyleItemView[] }
    }>,
  duplicateStyle: (id: string, newId: string, newName: string) =>
    ipcRenderer.invoke('styles:duplicate', id, newId, newName) as Promise<{
      items: StyleItemView[]
    }>,
  exportStyles: () => ipcRenderer.invoke('styles:export') as Promise<string>,
  importStyles: (json: string) =>
    ipcRenderer.invoke('styles:import', json) as Promise<{
      ok: boolean
      conflicts: Array<{ id: string; name: string }>
      items: StyleItemView[]
      error?: string
    }>,
  applyImport: (items: StyleItemView[], overwrite: boolean) =>
    ipcRenderer.invoke('styles:import-apply', items, overwrite) as Promise<{
      items: StyleItemView[]
    }>,

  // ---------- 语音输入 ----------
  getSpeechConfig: () =>
    ipcRenderer.invoke('speech:get-config') as Promise<{
      config: SpeechConfig
      hasKey: boolean
      configured: boolean
    }>,
  setSpeechKey: (key: string) => ipcRenderer.invoke('speech:set-key', key) as Promise<boolean>,
  hasSpeechKey: () => ipcRenderer.invoke('speech:has-key') as Promise<boolean>,
  getSpeechPreset: (id: string) =>
    ipcRenderer.invoke('speech:preset', id) as Promise<{
      id: string
      name: string
      baseUrl: string
      model: string
      apiType: 'transcriptions' | 'chat-audio'
    } | null>,
  transcribeAudio: (wav: ArrayBuffer) =>
    ipcRenderer.invoke('speech:transcribe', wav) as Promise<
      | { ok: true; text: string }
      | { ok: false; error: { message: string; suggestion?: string } }
    >,
  cancelTranscribe: () => ipcRenderer.invoke('speech:cancel') as Promise<boolean>,

  // ---------- 主进程事件 ----------
  onFocusInput: (handler: () => void) => subscribe<void>('window:focus-input', handler),
  onWindowShown: (handler: () => void) => subscribe<void>('window:shown', handler),
  onOpenSettings: (handler: () => void) => subscribe<void>('app:open-settings', handler),
  onShortcutChanged: (handler: (payload: { from: string; to: string }) => void) =>
    subscribe<{ from: string; to: string }>('app:shortcut-changed', handler)
}

contextBridge.exposeInMainWorld('preface', api)

export type PrefaceAPI = typeof api
