import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * 设置里的一次性迁移。
 *
 * 【为什么单独测这个】
 * 默认快捷键从 Ctrl+Alt+K 换成 Ctrl+Alt+X 之后，老用户的 settings.json
 * 里还存着 K，会盖住新默认值 —— 换了等于没换。迁移逻辑是"只在本地跑一次"
 * 的代码，最容易在以后被误删或改坏，所以这里用真的临时目录、真的文件，
 * 跑真实的 loadSettings()，而不是去断言源码里有没有某个字符串。
 */

let userDataDir: string
let loadSettings: () => {
  shortcut: string
  uiLanguage: 'zh' | 'en'
  translationTarget: string
  autoLaunch: boolean
  zoom: number
}
let saveSettings: (patch: Record<string, unknown>) => {
  shortcut: string
  uiLanguage: 'zh' | 'en'
  translationTarget: string
}

beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'preface-settings-'))
  vi.resetModules()

  // settings.ts / logger.ts 都从 electron 里拿 userData 路径。
  // 这里把整个 electron 模块换掉，指向刚建的临时目录。
  vi.doMock('electron', () => ({
    app: { getPath: () => userDataDir }
  }))

  const mod = await import('../src/main/settings')
  loadSettings = mod.loadSettings as never
  saveSettings = mod.saveSettings as never
})

function settingsFile(): string {
  return join(userDataDir, 'settings.json')
}

function writeSettings(data: unknown): void {
  writeFileSync(settingsFile(), JSON.stringify(data, null, 2), 'utf-8')
}

function readShortcutFromDisk(): string {
  return JSON.parse(readFileSync(settingsFile(), 'utf-8')).shortcut
}

describe('快捷键迁移', () => {
  it('把老的 Ctrl+Alt+K 迁到 Ctrl+Alt+X', () => {
    writeSettings({ shortcut: 'CommandOrControl+Alt+K' })

    expect(loadSettings().shortcut).toBe('CommandOrControl+Alt+X')
  })

  it('迁移结果立刻写回磁盘，不会每次启动都迁一遍', () => {
    writeSettings({ shortcut: 'CommandOrControl+Alt+K' })

    loadSettings()

    expect(readShortcutFromDisk()).toBe('CommandOrControl+Alt+X')
  })

  it('用户自己设的快捷键不会被覆盖', () => {
    writeSettings({ shortcut: 'CommandOrControl+Shift+F9' })

    expect(loadSettings().shortcut).toBe('CommandOrControl+Shift+F9')
    expect(readShortcutFromDisk()).toBe('CommandOrControl+Shift+F9')
  })

  it('设置文件里没有快捷键时用新默认值', () => {
    writeSettings({ autoLaunch: true })

    expect(loadSettings().shortcut).toBe('CommandOrControl+Alt+X')
  })

  it('设置文件不存在时用新默认值', () => {
    expect(loadSettings().shortcut).toBe('CommandOrControl+Alt+X')
  })

  it('迁移不会丢掉设置里的其他字段', () => {
    writeSettings({ shortcut: 'CommandOrControl+Alt+K', autoLaunch: true, zoom: 1.2 })

    loadSettings()

    const onDisk = JSON.parse(readFileSync(settingsFile(), 'utf-8'))
    expect(onDisk.autoLaunch).toBe(true)
    expect(onDisk.zoom).toBe(1.2)
  })

  it('保存后立即被 loadSettings 读到的是一致的值', () => {
    saveSettings({ shortcut: 'CommandOrControl+Alt+J' })

    expect(loadSettings().shortcut).toBe('CommandOrControl+Alt+J')
  })
})

describe('语言设置的默认值', () => {
  it('设置文件不存在时，界面语言是中文，翻译目标默认英语', () => {
    const settings = loadSettings()
    expect(settings.uiLanguage).toBe('zh')
    expect(settings.translationTarget).toBe('en')
  })

  it('老设置文件没有语言字段时自动补齐', () => {
    writeSettings({
      shortcut: 'CommandOrControl+Alt+X',
      autoLaunch: true,
      zoom: 1.2
    })

    const settings = loadSettings()
    expect(settings.uiLanguage).toBe('zh')
    expect(settings.translationTarget).toBe('en')
    expect(settings.autoLaunch).toBe(true)
    expect(settings.zoom).toBe(1.2)
  })

  it('保存后界面语言和翻译目标立刻生效', () => {
    saveSettings({ uiLanguage: 'en', translationTarget: 'ja' })

    const settings = loadSettings()
    expect(settings.uiLanguage).toBe('en')
    expect(settings.translationTarget).toBe('ja')

    const onDisk = JSON.parse(readFileSync(settingsFile(), 'utf-8'))
    expect(onDisk.uiLanguage).toBe('en')
    expect(onDisk.translationTarget).toBe('ja')
  })
})
