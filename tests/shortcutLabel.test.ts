import { describe, expect, it } from 'vitest'
import { shortcutLabel } from '../src/shared/shortcutLabel'

describe('shortcutLabel', () => {
  it('把 CommandOrControl 显示为 Ctrl', () => {
    expect(shortcutLabel('CommandOrControl+Alt+P')).toBe('Ctrl+Alt+P')
  })

  it('把空格显示为"空格"', () => {
    expect(shortcutLabel('CommandOrControl+Alt+Space')).toBe('Ctrl+Alt+空格')
  })

  it('处理 CmdOrCtrl 简写', () => {
    expect(shortcutLabel('CmdOrCtrl+Shift+K')).toBe('Ctrl+Shift+K')
  })

  it('处理单独的 Control', () => {
    expect(shortcutLabel('Control+Alt+P')).toBe('Ctrl+Alt+P')
  })

  it('处理回车和 Esc', () => {
    expect(shortcutLabel('CommandOrControl+Enter')).toBe('Ctrl+回车')
    expect(shortcutLabel('Escape')).toBe('Esc')
  })

  it('保留未识别的按键名', () => {
    expect(shortcutLabel('CommandOrControl+Alt+F5')).toBe('Ctrl+Alt+F5')
  })
})
