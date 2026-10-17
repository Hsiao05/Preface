import { app, screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { z } from 'zod'

/**
 * 默认窗口尺寸。
 *
 * 宽度按顶栏的实际需要定：两个按钮 + 三个下拉框（模型/风格/目标）
 * + 设置按钮，合计约 780px，再留一点余量给较长的模型配置名。
 * 700 会把「上传文件」「粘贴语料」压到换行。
 */
export const DEFAULT_WIDTH = 880
export const DEFAULT_HEIGHT = 720

const windowStateSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(200),
  height: z.number().min(200),
  maximized: z.boolean().optional()
})

export type WindowState = z.infer<typeof windowStateSchema>

const FILE = () => join(app.getPath('userData'), 'window-state.json')

const DEFAULTS: WindowState = {
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT
}

/**
 * 老版本用过的默认宽度。
 *
 * 560 → 700 是 0.1.x 的调整；700 → 880 是 0.2.1 的调整（顶栏按钮被挤压换行）。
 * 每一代都要保留，因为用户可能从任意一个老版本直接升级上来。
 */
const OLD_DEFAULT_WIDTHS = [560, 700]

/**
 * 把"从没动过的旧默认尺寸"换成新默认值。
 *
 * 【为什么需要】
 * 默认宽度从 560 加宽到 700、再到 880 之后，老用户的 window-state.json 里
 * 存着旧值 —— 存的值会盖住新默认值，等于没改。表现是装完新版本，窗口还是
 * 挤得很难看，用户会以为改动没生效。
 *
 * 只在"正好是那一组旧默认值"时才替换。用户自己拖过窗口的话，宽高不会
 * 恰好都落在旧默认值上，那种情况按用户的来。
 */
export function migrateWindowState(state: WindowState): WindowState {
  if (!OLD_DEFAULT_WIDTHS.includes(state.width)) return state
  if (state.height !== DEFAULTS.height) return state
  return { ...state, width: DEFAULT_WIDTH }
}

/** 读取窗口状态。文件不存在或损坏时返回默认值。 */
export function loadWindowState(): WindowState {
  try {
    const raw = readFileSync(FILE(), 'utf-8')
    const parsed = windowStateSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return { ...DEFAULTS }
    return ensureVisible(migrateWindowState(parsed.data))
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * 确认窗口落在某块屏幕的可见区域内。
 * 用户拔掉外接显示器后，原来的坐标可能已经在屏幕之外，这时退回默认位置。
 */
function ensureVisible(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    // 只要窗口有一部分落在工作区内就算可见
    return (
      state.x! < area.x + area.width &&
      state.x! + state.width > area.x &&
      state.y! < area.y + area.height &&
      state.y! + state.height > area.y
    )
  })

  if (!visible) {
    const { x, y, ...rest } = state
    return rest
  }
  return state
}

/** 保存窗口状态。写入前先写临时文件，避免中途崩溃留下半个文件。 */
export function saveWindowState(state: WindowState): void {
  const target = FILE()
  const temp = `${target}.tmp`
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(temp, target)
  } catch {
    // 保存失败不影响程序运行
  }
}

/** 从窗口对象上取当前状态 */
export function captureState(win: BrowserWindow): WindowState {
  const maximized = win.isMaximized()
  // 最大化时 bounds 是最大化后的尺寸，应该记住还原后的尺寸
  const bounds: Rectangle = maximized ? win.getNormalBounds() : win.getBounds()
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    maximized
  }
}
