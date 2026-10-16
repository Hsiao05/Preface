/**
 * 把 Electron 的快捷键写法转成用户看得懂的写法。
 * CommandOrControl+Alt+P → Ctrl+Alt+P
 * CommandOrControl+Alt+Space → Ctrl+Alt+空格
 */
export function shortcutLabel(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl|Command|Cmd/g, 'Ctrl')
    .replace(/Control/g, 'Ctrl')
    .replace(/Space/g, '空格')
    .replace(/Return|Enter/g, '回车')
    .replace(/Escape|Esc/g, 'Esc')
    .replace(/Plus/g, '+')
}
