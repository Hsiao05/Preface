// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SettingsGeneral } from '../src/renderer/components/settings/GeneralTab'
import { useStore } from '../src/renderer/store'
import type { Settings } from '../src/main/settings'

/**
 * 设置 → 通用 → 语言。
 *
 * 这一组设置决定整个界面的语言和翻译按钮上的语言名，切换后必须真的
 * 写进设置；自定义语言不能保存空值。
 */

const baseSettings = {
  shortcut: 'CommandOrControl+Alt+X',
  autoLaunch: false,
  alwaysOnTop: false,
  zoom: 1,
  theme: 'system',
  uiLanguage: 'zh',
  translationTarget: 'en',
  maxQuestions: 3,
  tidyUseStyleSamples: true,
  showTokenUsage: false,
  debugLog: false
} as Settings

let current: Settings
let setSettings: ReturnType<typeof vi.fn>

function mockPreface(): void {
  current = { ...baseSettings }
  setSettings = vi.fn(async (patch: Partial<Settings>) => {
    current = { ...current, ...patch }
    return { ok: true, settings: current }
  })
  ;(window as unknown as { preface: unknown }).preface = {
    getSettings: vi.fn(async () => current),
    setSettings,
    shortcutLabel: vi.fn(async (accelerator: string) => accelerator.replace('CommandOrControl', 'Ctrl')),
    getLogPath: vi.fn(async () => 'C:\\logs\\preface.log')
  }
}

async function renderSettings(): Promise<void> {
  render(<SettingsGeneral onNotice={() => {}} />)
  await screen.findByText('通用')
}

/** Fluent 的下拉框在 jsdom 里会把选项渲染到 portal，按可见文字选。 */
async function chooseOption(label: string, option: string): Promise<void> {
  fireEvent.click(screen.getByRole('combobox', { name: label }))
  const item = await screen.findByRole('option', { name: option })
  fireEvent.click(item)
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
  useStore.setState({ uiLanguage: 'zh' })
  mockPreface()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('界面语言', () => {
  it('切换到 English 会保存 uiLanguage，界面随之变成英文', async () => {
    await renderSettings()

    expect(screen.getByText('界面语言')).toBeTruthy()
    await chooseOption('界面语言', 'English')

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({ uiLanguage: 'en' })
    })

    // 主窗口收到广播后会更新 store；设置页本身也应该立即显示英文
    useStore.setState({ uiLanguage: 'en' })
    await screen.findByText('Interface language')
    expect(screen.getByText('Translation language')).toBeTruthy()
    expect(screen.queryByText('界面语言')).toBeNull()
  })

  it('中文界面下两个选项都有，English 用英文写法', async () => {
    await renderSettings()

    fireEvent.click(screen.getByRole('combobox', { name: '界面语言' }))

    expect(await screen.findByRole('option', { name: '中文' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'English' })).toBeTruthy()
  })
})

describe('翻译目标语言', () => {
  it('预设语言保存语言 id，按钮文案用当前语言显示名称', async () => {
    await renderSettings()

    expect(screen.getByText('英语')).toBeTruthy()
    await chooseOption('翻译目标语言', '日语')

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({ translationTarget: 'ja' })
    })
  })

  it('自定义语言：空值不保存并提示，填写后保存清理过的名称', async () => {
    await renderSettings()

    await chooseOption('翻译目标语言', '自定义…')

    const input = await screen.findByPlaceholderText('例如：俄语、荷兰语、粤语')
    fireEvent.blur(input)

    expect(screen.getByText('请输入目标语言名称。')).toBeTruthy()
    expect(setSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ translationTarget: expect.anything() })
    )

    fireEvent.change(input, { target: { value: '  俄语  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({ translationTarget: '俄语' })
    })
  })

  it('选择自定义后再选回预设，自定义输入框消失', async () => {
    await renderSettings()

    await chooseOption('翻译目标语言', '自定义…')
    await screen.findByPlaceholderText('例如：俄语、荷兰语、粤语')

    await chooseOption('翻译目标语言', '法语')

    await waitFor(() => {
      expect(setSettings).toHaveBeenCalledWith({ translationTarget: 'fr' })
    })
    expect(
      screen.queryByPlaceholderText('例如：俄语、荷兰语、粤语')
    ).toBeNull()
  })
})
