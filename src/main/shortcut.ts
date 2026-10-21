import { dialog, globalShortcut } from 'electron'
import { log } from './logger'
import { toggleWindow } from './window'
import { mainT, getUiLanguage } from './i18n'
import { shortcutLabel } from '../shared/shortcutLabel'

export { shortcutLabel }

let registered: string | null = null

/**
 * 注册全局快捷键。
 * 返回 true 表示成功。失败时不抛异常，由调用方决定怎么提示用户。
 */
export function registerShortcut(accelerator: string, options: { silent?: boolean } = {}): boolean {
  unregisterShortcut()

  let ok = false
  try {
    ok = globalShortcut.register(accelerator, () => {
      toggleWindow()
    })
  } catch (error) {
    log(`快捷键注册异常: ${String(error)}`)
    ok = false
  }

  if (ok) {
    registered = accelerator
    log(`快捷键注册成功: ${accelerator}`)
    return true
  }

  log(`快捷键注册失败: ${accelerator}`)

  if (!options.silent) {
    dialog.showMessageBox({
      type: 'warning',
      title: mainT('shortcut.takenTitle'),
      message: mainT('shortcut.takenMessage', {
        shortcut: shortcutLabel(accelerator, getUiLanguage())
      }),
      detail: mainT('shortcut.takenDetail'),
      buttons: [mainT('shortcut.ok')]
    })
  }

  return false
}

export function unregisterShortcut(): void {
  if (registered) {
    try {
      globalShortcut.unregister(registered)
    } catch {
      // 忽略
    }
    registered = null
  }
}

export function getRegisteredShortcut(): string | null {
  return registered
}

/**
 * 注册快捷键，失败时依次尝试几个备选。
 * 这样即使用户的默认快捷键被占用，程序第一次启动时也能用起来。
 */
export function registerShortcutWithFallback(
  preferred: string,
  fallbacks: string[] = [
    'CommandOrControl+Alt+U',
    'CommandOrControl+Alt+K',
    'CommandOrControl+Shift+Space'
  ]
): { accelerator: string | null; usedFallback: boolean } {
  if (registerShortcut(preferred, { silent: true })) {
    return { accelerator: preferred, usedFallback: false }
  }

  for (const candidate of fallbacks) {
    if (candidate === preferred) continue
    if (registerShortcut(candidate, { silent: true })) {
      return { accelerator: candidate, usedFallback: true }
    }
  }

  return { accelerator: null, usedFallback: false }
}

