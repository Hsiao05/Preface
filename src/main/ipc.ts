import { ipcMain, app, clipboard, BrowserWindow } from 'electron'
import { join } from 'path'
import { loadSettings, saveSettings, type Settings } from './settings'
import { registerShortcut, shortcutLabel, unregisterShortcut } from './shortcut'
import {
  applyTheme,
  applyZoom,
  getMainWindow,
  hideWindow,
  persistWindowState,
  refreshTrayLanguage,
  setAlwaysOnTop
} from './window'
import { getLogFilePath, log, setContentLoggingEnabled } from './logger'
import { mainT, getUiLanguage } from './i18n'
import { pickFiles, showInFolder, startDrag, statFiles, toFileResources } from './files'
import {
  archiveDraft,
  clearPreviousDraft,
  loadCurrentDraft,
  loadPreviousDraft,
  saveCurrentDraft
} from './draftStore'
import {
  clearAllSnapshots,
  deleteSnapshot,
  listSnapshots,
  loadSnapshot,
  pruneByRetention,
  saveSnapshot
} from './draftHistory'
import {
  cancelTranscribe,
  isSpeechConfigured,
  presetById,
  SPEECH_SECRET_ID,
  SpeechError,
  transcribe
} from './speech'
import { transcribeAudioFile } from './speech/audioFile'
import { getSecret as getSecretRaw } from './secrets'
import type { SpeechConfig } from '../shared/speech'
import {
  deleteItem,
  duplicateStyle,
  exportStyles,
  hasBuiltinUpdate,
  importStyles,
  loadStyles,
  replaceAll,
  resetItem,
  saveItem,
  type StyleItem
} from './stylesStore'
import {
  deleteProfile,
  getProfile,
  loadProfiles,
  saveProfile,
  setCurrentProfile,
  type ModelProfile
} from './profiles'
import {
  deletePromptItem,
  listPromptItems,
  PromptLibraryError,
  savePromptItem,
  type SavePromptInput
} from './promptLibraryStore'
import { hasSecret, removeSecret, setSecret } from './secrets'
import {
  cancelAllRequests,
  cancelRequest,
  doListModels,
  doTestConnection,
  startRun,
  CALL_SPECS,
  type CallKind
} from './llm'
import type { ChatMessage } from './llm/client'
import type { Draft } from '../shared/types'

/** 拖出文件时用的图标，没有图标 startDrag 会报错 */
function dragIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'resources', 'icon.png')
}

export function setupIpc(): void {
  // ---------- 设置 ----------
  ipcMain.handle('settings:get', () => loadSettings())

  ipcMain.handle('settings:set', (_event, patch: Partial<Settings>) => {
    const before = loadSettings()
    const next = saveSettings(patch)

    // 设置项里有些需要立刻作用到主进程
    if (patch.shortcut !== undefined && patch.shortcut !== before.shortcut) {
      const ok = registerShortcut(next.shortcut)
      if (!ok) {
        // 注册失败就退回原来的快捷键，并告诉界面
        registerShortcut(before.shortcut, { silent: true })
        saveSettings({ shortcut: before.shortcut })
        return { ok: false, reason: 'occupied', settings: loadSettings() }
      }
    }

    if (patch.alwaysOnTop !== undefined) setAlwaysOnTop(next.alwaysOnTop)
    if (patch.theme !== undefined) applyTheme(next.theme)
    if (patch.zoom !== undefined) applyZoom(next.zoom)
    if (patch.debugLog !== undefined) setContentLoggingEnabled(next.debugLog)
    if (patch.autoLaunch !== undefined) applyAutoLaunch(next.autoLaunch)

    // 界面语言变了：窗口标题和托盘菜单要跟着换
    if (patch.uiLanguage !== undefined && next.uiLanguage !== before.uiLanguage) {
      refreshTrayLanguage()
    }

    // 保留时长变短时，立刻按新规则清理一次
    if (patch.snapshotRetentionMinutes !== undefined) {
      pruneByRetention(next.snapshotRetentionMinutes)
    }

    return { ok: true, settings: next }
  })

  // ---------- 窗口 ----------
  ipcMain.handle('window:hide', () => {
    persistWindowState()
    hideWindow()
  })
  ipcMain.handle('window:get-log-path', () => getLogFilePath())

  // ---------- 应用 ----------
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:shortcut-label', (_event, accelerator: string) =>
    shortcutLabel(accelerator, getUiLanguage())
  )

  // ---------- 草稿 ----------
  ipcMain.handle('draft:load', () => loadCurrentDraft())
  ipcMain.handle('draft:save', (_event, draft: Draft) => {
    saveCurrentDraft(draft)
    return true
  })
  ipcMain.handle('draft:archive', (_event, draft: Draft) => {
    archiveDraft(draft)
    return true
  })
  ipcMain.handle('draft:load-previous', () => loadPreviousDraft())
  ipcMain.handle('draft:clear-previous', () => {
    clearPreviousDraft()
    return true
  })

  // ---------- 草稿历史（"找回之前的内容"）----------
  ipcMain.handle('history:save', (_event, draft: Draft, reason: 'copied' | 'cleared' | 'manual') => {
    const snapshot = saveSnapshot(draft, reason)
    return snapshot !== null
  })

  ipcMain.handle('history:list', () => {
    const settings = loadSettings()
    return listSnapshots(settings.snapshotRetentionMinutes)
  })

  ipcMain.handle('history:load', (_event, id: string) => loadSnapshot(id))

  ipcMain.handle('history:delete', (_event, id: string) => deleteSnapshot(id))

  ipcMain.handle('history:clear-all', () => clearAllSnapshots())

  ipcMain.handle('history:prune', () => {
    const settings = loadSettings()
    return pruneByRetention(settings.snapshotRetentionMinutes)
  })

  // ---------- 文件 ----------
  ipcMain.handle('files:pick', async () => {
    const paths = await pickFiles(getMainWindow())
    return paths
  })

  ipcMain.handle(
    'files:add',
    async (_event, paths: string[], existing: Draft['files'], intentText: string, nextNo: number) => {
      // intentText 用来判断哪些编号还被引用着 —— 还在被引用的编号不能复用
      const result = await toFileResources(paths, existing, intentText, nextNo)
      return result
    }
  )

  ipcMain.handle('files:stat', async (_event, paths: string[]) => {
    return statFiles(paths)
  })

  ipcMain.handle('files:show-in-folder', (_event, path: string) => {
    showInFolder(path)
    return true
  })

  ipcMain.handle('files:start-drag', (event, paths: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return false
    startDrag(win, paths, dragIconPath())
    return true
  })

  // ---------- 剪贴板 ----------
  ipcMain.handle('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
    return true
  })

  // ---------- 模型配置 ----------
  ipcMain.handle('profiles:list', () => {
    const data = loadProfiles()
    // 附上"有没有 Key"，但不返回 Key 本身
    return {
      currentId: data.currentId,
      profiles: data.profiles.map((p) => ({
        ...p,
        hasKey: hasSecret(p.id)
      }))
    }
  })

  ipcMain.handle('profiles:save', (_event, profile: ModelProfile) => {
    saveProfile(profile)
    return loadProfiles()
  })

  ipcMain.handle('profiles:delete', (_event, id: string) => {
    deleteProfile(id)
    removeSecret(id)
    return loadProfiles()
  })

  ipcMain.handle('profiles:set-current', (_event, id: string | null) => {
    setCurrentProfile(id)
    return loadProfiles()
  })

  // ---------- API Key ----------
  // 界面只能问"有没有设置"，永远拿不到明文
  ipcMain.handle('secrets:set', (_event, profileId: string, key: string) => {
    const ok = setSecret(profileId, key)
    log(`保存 API Key（配置 ${profileId}）: ${ok ? '成功' : '失败'}`)
    return ok
  })

  ipcMain.handle('secrets:has', (_event, profileId: string) => hasSecret(profileId))

  ipcMain.handle('secrets:clear', (_event, profileId: string) => {
    removeSecret(profileId)
    return true
  })

  // ---------- 模型调用 ----------
  ipcMain.handle('llm:list-models', (_event, profileId?: string) => doListModels(profileId))

  ipcMain.handle('llm:test', (_event, profileId?: string) => doTestConnection(profileId))

  ipcMain.handle(
    'llm:run',
    async (
      _event,
      kind: CallKind,
      messages: ChatMessage[],
      sourceText?: string,
      // 频道由界面生成，这样它能先注册监听再发起调用，不会漏掉开头的内容
      channel?: string
    ) => {
      if (!Object.prototype.hasOwnProperty.call(CALL_SPECS, kind)) {
        throw new Error(mainT('error.unknownCallKind', { kind: String(kind) }))
      }
      const target = channel ?? `llm:event:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const { requestId } = await startRun({ kind, messages, sourceText }, target)
      return { requestId, channel: target }
    }
  )

  ipcMain.handle('llm:cancel', (_event, requestId: string) => cancelRequest(requestId))

  // 界面可以直接问某套配置是否完整
  ipcMain.handle('profiles:get', (_event, id: string) => getProfile(id))

  // ---------- 提示词与风格 ----------
  ipcMain.handle('styles:list', () => {
    const data = loadStyles()
    // 附上"内置版本是否有更新"，供设置页显示提示
    return {
      items: data.items.map((item) => ({
        ...item,
        hasBuiltinUpdate: hasBuiltinUpdate(item)
      }))
    }
  })

  ipcMain.handle('styles:save', (_event, item: StyleItem) => {
    saveItem(item)
    return loadStyles()
  })

  ipcMain.handle('styles:reset', (_event, id: string) => {
    resetItem(id)
    return loadStyles()
  })

  ipcMain.handle('styles:delete', (_event, id: string) => {
    const result = deleteItem(id)
    return { ok: result.ok, styles: result.styles }
  })

  ipcMain.handle('styles:duplicate', (_event, id: string, newId: string, newName: string) => {
    duplicateStyle(id, newId, newName)
    return loadStyles()
  })

  ipcMain.handle('styles:export', () => exportStyles())

  ipcMain.handle('styles:import', (_event, json: string) => importStyles(json))

  // ---------- 我的 Prompt 库 ----------
  /** 统一的错误出口：损坏的库要明确告诉用户，不能显示成空库 */
  const promptFailure = (error: unknown): { ok: false; error: string; items: [] } => {
    const message =
      error instanceof PromptLibraryError
        ? error.message
        : error instanceof Error
          ? error.message
          : mainT('promptLibrary.errorFailed')
    log(`Prompt 库操作失败: ${message}`)
    return { ok: false, error: message, items: [] }
  }

  ipcMain.handle('prompt-library:list', () => {
    try {
      return { ok: true as const, items: listPromptItems().items }
    } catch (error) {
      return promptFailure(error)
    }
  })

  ipcMain.handle('prompt-library:save', async (_event, input: SavePromptInput) => {
    try {
      // 只挑需要的字段，界面多传的东西一概不接受
      const safe: SavePromptInput = {
        id: input?.id,
        title: input?.title,
        content: input?.content,
        titleSource: input?.titleSource
      }
      const data = await savePromptItem(safe)
      return { ok: true as const, items: data.items }
    } catch (error) {
      return promptFailure(error)
    }
  })

  ipcMain.handle('prompt-library:delete', async (_event, id: string) => {
    try {
      const data = await deletePromptItem(id)
      return { ok: true as const, items: data.items }
    } catch (error) {
      return promptFailure(error)
    }
  })

  // ---------- 语音输入 ----------
  ipcMain.handle('speech:get-config', () => {
    const settings = loadSettings()
    const speech = settings.speech
    const config: SpeechConfig = {
      preset: speech.preset,
      baseUrl: speech.baseUrl,
      model: speech.model,
      apiType: speech.apiType,
      language: speech.language,
      maxSeconds: speech.maxSeconds
    }
    return {
      config,
      hasKey: hasSecret(SPEECH_SECRET_ID),
      configured: isSpeechConfigured(config, hasSecret(SPEECH_SECRET_ID))
    }
  })

  ipcMain.handle('speech:set-key', (_event, key: string) => {
    const ok = setSecret(SPEECH_SECRET_ID, key)
    log(`保存语音 API Key: ${ok ? '成功' : '失败'}`)
    return ok
  })

  ipcMain.handle('speech:has-key', () => hasSecret(SPEECH_SECRET_ID))

  ipcMain.handle('speech:preset', (_event, id: string) => presetById(id) ?? null)

  /** 当前语音配置和解密后的 Key。两个识别入口共用，避免两份配置逻辑。 */
  function currentSpeechContext():
    | { ok: true; config: SpeechConfig; apiKey: string }
    | { ok: false; error: { message: string; suggestion: string } } {
    const speech = loadSettings().speech
    const apiKey = getSecretRaw(SPEECH_SECRET_ID)

    if (!apiKey) {
      return {
        ok: false,
        error: {
          message: mainT('speech.missingKey'),
          suggestion: mainT('speech.missingKeyHint')
        }
      }
    }

    return {
      ok: true,
      apiKey,
      config: {
        preset: speech.preset,
        baseUrl: speech.baseUrl,
        model: speech.model,
        apiType: speech.apiType,
        language: speech.language,
        maxSeconds: speech.maxSeconds
      }
    }
  }

  /** 把识别过程抛出的错误转成界面直接显示的中文 */
  function speechFailure(error: unknown): {
    ok: false
    error: { message: string; suggestion?: string }
  } {
    if (error instanceof SpeechError) {
      return { ok: false, error: { message: error.message, suggestion: error.suggestion } }
    }
    return {
      ok: false,
      error: { message: mainT('speech.failed'), suggestion: mainT('speech.failedHint') }
    }
  }

  /**
   * 识别一段音频。
   * WAV 数据通过 IPC 传进来，请求由主进程发出（界面进程不碰网络）。
   */
  ipcMain.handle('speech:transcribe', async (_event, wavData: ArrayBuffer) => {
    const context = currentSpeechContext()
    if (!context.ok) return context

    try {
      const text = await transcribe({
        audio: new Uint8Array(wavData),
        config: context.config,
        apiKey: context.apiKey
      })
      return { ok: true, text }
    } catch (error) {
      return speechFailure(error)
    }
  })

  /**
   * 转录一个音频文件。
   *
   * 【这是唯一读取文件内容的地方】
   * 只有用户在资料栏点击音频、再点「开始转录」才会走到这里。
   * 读取只发生在主进程，界面只拿到文字。
   */
  ipcMain.handle('speech:transcribe-file', async (_event, path: unknown) => {
    if (typeof path !== 'string' || !path) {
      return {
        ok: false,
        error: {
          message: mainT('speech.invalidPath'),
          suggestion: mainT('speech.invalidPathHint')
        }
      }
    }

    const context = currentSpeechContext()
    if (!context.ok) return context

    try {
      const text = await transcribeAudioFile({
        path,
        config: context.config,
        apiKey: context.apiKey
      })
      return { ok: true, text }
    } catch (error) {
      return speechFailure(error)
    }
  })

  ipcMain.handle('speech:cancel', () => cancelTranscribe())

  ipcMain.handle(
    'styles:import-apply',
    (_event, items: StyleItem[], overwrite: boolean) => {
      const existing = loadStyles().items

      if (overwrite) {
        // 覆盖同名的，其余合并
        const incoming = new Map(items.map((i) => [i.id, i]))
        const merged = existing.map((i) => incoming.get(i.id) ?? i)
        const existingIds = new Set(existing.map((i) => i.id))
        const added = items.filter((i) => !existingIds.has(i.id))
        return replaceAll([...merged, ...added])
      }

      // 另存为新项：给冲突的 id 加后缀
      const existingIds = new Set(existing.map((i) => i.id))
      const renamed = items.map((item) => {
        if (!existingIds.has(item.id)) return item
        const suffix = Date.now().toString(36).slice(-4)
        return { ...item, id: `${item.id}-${suffix}`, name: mainT('styles.importedName', { name: item.name }), builtin: false, builtinVersion: 0 }
      })
      return replaceAll([...existing, ...renamed])
    }
  )
}

/** 程序退出前取消所有进行中的请求 */
export function cancelPendingRequests(): void {
  cancelAllRequests()
}

/** 开机自启。打包后才有意义，开发环境下跳过。 */
function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch (error) {
    log(`设置开机自启失败: ${String(error)}`)
  }
}

export { unregisterShortcut }
