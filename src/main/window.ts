import { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, screen } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { captureState, loadWindowState, saveWindowState } from './windowState'
import { log } from './logger'

const isDev = !app.isPackaged

/** 资源目录：开发时在项目根目录，打包后在 resources 里 */
function resourcePath(file: string): string {
  if (isDev) return join(app.getAppPath(), 'resources', file)
  return join(process.resourcesPath, file)
}

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

// 标记是否真的要退出程序（区分"关闭窗口"和"退出应用"）
let quitting = false

export function isQuitting(): boolean {
  return quitting
}

export function setQuitting(value: boolean): void {
  quitting = value
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createWindow(): BrowserWindow {
  const state = loadWindowState()

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 420,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    title: '序 · Preface',
    icon: resourcePath('icon.png'),
    // 背景色跟着主题，避免深色模式下启动瞬间闪白
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (state.maximized) mainWindow.maximize()

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // 呼出时把光标放进输入框
    focusIntentInput()
  })

  // 点关闭按钮只是隐藏到托盘
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // 位置或大小变化后记下来（防抖，避免拖动时频繁写盘）
  let saveTimer: NodeJS.Timeout | null = null
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveWindowState(captureState(mainWindow))
      }
    }, 400)
  }

  mainWindow.on('resize', scheduleSave)
  mainWindow.on('move', scheduleSave)
  mainWindow.on('maximize', scheduleSave)
  mainWindow.on('unmaximize', scheduleSave)

  // 隐藏时立刻保存一次
  mainWindow.on('hide', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      saveWindowState(captureState(mainWindow))
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

/** 让输入框获得焦点。渲染进程收到这个事件后把光标放进意图输入框。 */
function focusIntentInput(): void {
  mainWindow?.webContents.send('window:focus-input')
}

export function showWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  const wasHidden = !mainWindow.isVisible()
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  // 从隐藏状态被呼出时通知界面：复制过的草稿这时要换成新的
  if (wasHidden) {
    mainWindow.webContents.send('window:shown')
  }
  focusIntentInput()
}

export function toggleWindow(): void {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    showWindow()
  }
}

export function hideWindow(): void {
  mainWindow?.hide()
}

export function setAlwaysOnTop(value: boolean): void {
  mainWindow?.setAlwaysOnTop(value)
}

/**
 * 应用界面缩放。
 *
 * 用 webContents.setZoomFactor，效果和浏览器的 Ctrl+加减 一样，
 * 整个界面（含字号、间距）一起缩放。
 */
export function applyZoom(zoom: number): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.setZoomFactor(zoom)
  }
}

/**
 * 应用深浅色模式。
 *
 * 用 nativeTheme.themeSource 统一控制：
 * - 窗口边框、标题栏、滚动条等系统绘制的部分会自动跟着变
 * - Mica 材质也会跟着变（深色下是深色 Mica）
 * - 渲染进程可以通过 prefers-color-scheme 感知到
 */
export function applyTheme(theme: 'system' | 'light' | 'dark'): void {
  nativeTheme.themeSource = theme

  // 窗口背景色要手动跟着改一次（创建后不会再自动更新）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3')
  }
}

/** 创建托盘图标和菜单 */
export function createTray(onOpenSettings: () => void): void {
  const iconFile = resourcePath('tray.png')
  if (!existsSync(iconFile)) {
    log('托盘图标不存在，跳过托盘创建: ' + iconFile)
    return
  }

  tray = new Tray(nativeImage.createFromPath(iconFile))
  const menu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => showWindow() },
    { label: '设置', click: () => onOpenSettings() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        setQuitting(true)
        app.quit()
      }
    }
  ])

  tray.setToolTip('序 · Preface')
  tray.setContextMenu(menu)

  // 左键单击切换显示/隐藏
  tray.on('click', () => toggleWindow())
}

/** 保存窗口状态，程序退出前调用 */
export function persistWindowState(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    saveWindowState(captureState(mainWindow))
  }
}

/** 供渲染进程查询屏幕信息（例如判断是否 Windows 11） */
export function getDisplayInfo(): { workArea: Electron.Rectangle; scaleFactor: number } {
  const display = mainWindow
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()
  return { workArea: display.workArea, scaleFactor: display.scaleFactor }
}
