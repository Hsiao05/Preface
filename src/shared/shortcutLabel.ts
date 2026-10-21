import { translate, type UiLanguage } from './i18n'

/**
 * 把 Electron 的快捷键写法转成用户看得懂的写法。
 * CommandOrControl+Alt+P → Ctrl+Alt+P
 * CommandOrControl+Alt+Space → Ctrl+Alt+空格（英文界面为 Space）
 */
export function shortcutLabel(accelerator: string, language: UiLanguage = 'zh'): string {
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, 'Ctrl')
    .replace(/Control/g, 'Ctrl')
    .replace(/Space/g, translate(language, 'shortcut.space'))
    .replace(/Return|Enter/g, translate(language, 'shortcut.enter'))
    .replace(/Escape|Esc/g, 'Esc')
    .replace(/Plus/g, '+')
}
