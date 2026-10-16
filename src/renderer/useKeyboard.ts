import { useEffect } from 'react'

/**
 * 判断按键是否应当忽略。
 *
 * 中文输入法组字期间（isComposing 为 true），所有快捷键一律不触发，
 * 否则用户按回车选字时会被当成"优化提示词"。
 */
function shouldIgnore(event: KeyboardEvent): boolean {
  // keyCode 229 是部分浏览器在组字期间的表现
  return event.isComposing || event.keyCode === 229
}

/**
 * 全局键盘操作。
 * 传 null 表示该操作当前不可用。
 */
export function useKeyboard(handlers: {
  onOptimize: (() => void) | null
  onCopy: (() => void) | null
  onEscape: () => void
}): void {
  const { onOptimize, onCopy, onEscape } = handlers

  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (shouldIgnore(event)) return

      const ctrl = event.ctrlKey || event.metaKey

      // Ctrl+Enter：优化提示词
      if (ctrl && event.key === 'Enter') {
        if (!onOptimize) return
        event.preventDefault()
        onOptimize()
        return
      }

      // Ctrl+Shift+C：一键复制
      if (ctrl && event.shiftKey && event.key.toLowerCase() === 'c') {
        if (!onCopy) return
        event.preventDefault()
        onCopy()
        return
      }

      // Esc：关闭面板，没有面板时隐藏窗口
      if (event.key === 'Escape') {
        event.preventDefault()
        onEscape()
      }
    }

    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [onOptimize, onCopy, onEscape])
}
