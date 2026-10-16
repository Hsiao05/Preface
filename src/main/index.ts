import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { log, setContentLoggingEnabled } from './logger'
import { loadSettings, saveSettings } from './settings'
import {
  applyTheme,
  applyZoom,
  createTray,
  createWindow,
  getMainWindow,
  persistWindowState,
  setQuitting,
  setAlwaysOnTop
} from './window'
import { registerShortcutWithFallback, shortcutLabel, unregisterShortcut } from './shortcut'
import { cancelPendingRequests, setupIpc } from './ipc'

// 开发环境下使用独立的 userData 目录，避免和同名的其他实例抢占单实例锁
if (is.dev) {
  app.setPath('userData', join(app.getPath('appData'), 'preface-dev'))
}

// 单实例锁：重复启动时只激活已有的窗口
if (!app.requestSingleInstanceLock()) {
  log('已有实例在运行，本次启动退出')
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.preface')

    const settings = loadSettings()
    setContentLoggingEnabled(settings.debugLog)
    log('应用启动')
    log('userData: ' + app.getPath('userData'))

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const win = createWindow()
    setAlwaysOnTop(settings.alwaysOnTop)
    applyTheme(settings.theme)
    applyZoom(settings.zoom)
    createTray(() => {
      win.show()
      win.webContents.send('app:open-settings')
    })

    setupIpc()
    setupMicrophonePermission()

    // 注册全局快捷键，被占用时自动换备选
    const { accelerator, usedFallback } = registerShortcutWithFallback(settings.shortcut)
    if (accelerator === null) {
      log('所有候选快捷键都被占用')
    } else if (usedFallback) {
      // 记下换过的快捷键，并提示用户
      saveSettings({ shortcut: accelerator })
      log(`默认快捷键被占用，已改用 ${accelerator}`)
      win.webContents.once('did-finish-load', () => {
        win.webContents.send('app:shortcut-changed', {
          from: shortcutLabel(settings.shortcut),
          to: shortcutLabel(accelerator)
        })
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  /**
 * 麦克风权限。
 *
 * 只允许本程序窗口的音频请求，其他一律拒绝。
 * Electron 默认会拒绝媒体权限请求，所以必须显式放行，
 * 否则 getUserMedia 会直接失败。
 */
function setupMicrophonePermission(): void {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission !== 'media') {
      callback(false)
      return
    }

    // 只放行我们自己窗口发起的请求
    const allowed = BrowserWindow.getAllWindows().some(
      (win) => !win.isDestroyed() && win.webContents.id === webContents.id
    )

    log(`麦克风权限请求：${allowed ? '允许' : '拒绝'}`)
    callback(allowed)
  })
}

app.on('window-all-closed', () => {
    // 窗口关闭只是隐藏，不退出程序
  })

  app.on('before-quit', () => {
    setQuitting(true)
    persistWindowState()
    // 取消所有进行中的模型请求，避免退出时卡住
    cancelPendingRequests()
  })

  app.on('will-quit', () => {
    unregisterShortcut()
  })
}
