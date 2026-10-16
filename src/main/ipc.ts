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
  setAlwaysOnTop
} from './window'
import { getLogFilePath, log, setContentLoggingEnabled } from './logger'
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
import { hasSecret, removeSecret, setSecret } from './secrets'
import {
  cancelAllRequests,
  cancelRequest,
  doListModels,
  doTestConnection,
  startRun,
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
  ipcMain.handle('app:shortcut-label', (_event, accelerator: string) => shortcutLabel(accelerator))

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

  /**
   * 识别一段音频。
   * WAV 数据通过 IPC 传进来，请求由主进程发出（界面进程不碰网络）。
   */
  ipcMain.handle('speech:transcribe', async (_event, wavData: ArrayBuffer) => {
    const settings = loadSettings()
    const speech = settings.speech
    const apiKey = getSecretRaw(SPEECH_SECRET_ID)

    if (!apiKey) {
      return {
        ok: false,
        error: { message: '还没有填语音 API Key', suggestion: '请到「设置 → 语音」里填写。' }
      }
    }

    const config: SpeechConfig = {
      preset: speech.preset,
      baseUrl: speech.baseUrl,
      model: speech.model,
      apiType: speech.apiType,
      language: speech.language,
      maxSeconds: speech.maxSeconds
    }

    try {
      const text = await transcribe({
        wav: new Uint8Array(wavData),
        config,
        apiKey
      })
      return { ok: true, text }
    } catch (error) {
      if (error instanceof SpeechError) {
        return {
          ok: false,
          error: { message: error.message, suggestion: error.suggestion }
        }
      }
      return {
        ok: false,
        error: { message: '识别失败', suggestion: '请检查「设置 → 语音」里的配置。' }
      }
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
        return { ...item, id: `${item.id}-${suffix}`, name: `${item.name}（导入）`, builtin: false, builtinVersion: 0 }
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
