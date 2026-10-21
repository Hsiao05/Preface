import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * 窗口尺寸的一次性迁移。
 *
 * 【为什么单独测这个】
 * 默认宽度从 560 加宽到 700、再到 880，最后定为 850 之后，老用户的
 * window-state.json 里存着旧值，会盖住新默认值 —— 装完新版本窗口还是挤得
 * 很难看，用户会以为改动没生效。这段迁移代码只在本地跑一次，最容易在以后
 * 被误删，所以这里用真的临时目录、真的文件去跑真实的 loadWindowState()。
 */

let userDataDir: string
let loadWindowState: () => { x?: number; y?: number; width: number; height: number }

beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'preface-windowstate-'))
  vi.resetModules()

  vi.doMock('electron', () => ({
    app: { getPath: () => userDataDir },
    // 一块足够大的屏幕，保证窗口都算"可见"，不会走 ensureVisible 的兜底
    screen: {
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 3840, height: 2160 } }]
    }
  }))

  const mod = await import('../src/main/windowState')
  loadWindowState = mod.loadWindowState as never
})

function writeState(data: unknown): void {
  writeFileSync(join(userDataDir, 'window-state.json'), JSON.stringify(data), 'utf-8')
}

describe('窗口尺寸迁移', () => {
  it('把最早那代旧默认宽度 560 换成 850', () => {
    writeState({ x: 100, y: 100, width: 560, height: 720, maximized: false })

    const state = loadWindowState()

    expect(state.width).toBe(850)
    expect(state.height).toBe(720)
  })

  it('把上一代旧默认宽度 700 也换成 850（顶栏按钮换行的那次）', () => {
    writeState({ x: 100, y: 100, width: 700, height: 720, maximized: false })

    const state = loadWindowState()

    expect(state.width).toBe(850)
    expect(state.height).toBe(720)
  })

  it('把 0.3 的旧默认宽度 880 换成 850', () => {
    writeState({ x: 100, y: 100, width: 880, height: 720, maximized: false })

    const state = loadWindowState()

    expect(state.width).toBe(850)
    expect(state.height).toBe(720)
  })

  it('把开发期用过的 960 换成 850', () => {
    writeState({ x: 100, y: 100, width: 960, height: 720, maximized: false })

    const state = loadWindowState()

    expect(state.width).toBe(850)
    expect(state.height).toBe(720)
  })

  it('保留窗口原来的位置', () => {
    writeState({ x: 680, y: 156, width: 560, height: 720 })

    const state = loadWindowState()

    expect(state.x).toBe(680)
    expect(state.y).toBe(156)
  })

  it('用户自己拖过的宽度不会被改', () => {
    writeState({ x: 100, y: 100, width: 812, height: 900 })

    const state = loadWindowState()

    expect(state.width).toBe(812)
    expect(state.height).toBe(900)
  })

  it('只改了高度、宽度还是旧默认值的也算用户自己调过', () => {
    writeState({ x: 100, y: 100, width: 700, height: 1100 })

    const state = loadWindowState()

    expect(state.width).toBe(700)
    expect(state.height).toBe(1100)
  })

  it('高度恰好等于旧默认值但宽度不是的，不算旧默认尺寸', () => {
    // 用户把 700 拖宽到 760，高度没动 —— 这是用户的尺寸，不要改
    writeState({ x: 100, y: 100, width: 760, height: 720 })

    const state = loadWindowState()

    expect(state.width).toBe(760)
  })

  it('文件不存在时用新默认尺寸', () => {
    const state = loadWindowState()

    expect(state.width).toBe(850)
    expect(state.height).toBe(720)
  })
})
