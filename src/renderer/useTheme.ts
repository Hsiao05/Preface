import { useEffect, useState } from 'react'
import { webDarkTheme, webLightTheme, type Theme } from '@fluentui/react-components'

/**
 * 深浅色模式。
 *
 * 主进程用 nativeTheme.themeSource 统一控制，渲染进程只需要跟随
 * prefers-color-scheme 的媒体查询即可 —— 用户选"跟随设备"时，
 * 系统主题变化也会实时反映到界面上。
 */

export type ThemeMode = 'system' | 'light' | 'dark'

/** 当前系统是不是深色 */
function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 根据设置项算出实际该用浅色还是深色 */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemPrefersDark()
}

/** 取对应的 Fluent 主题对象 */
export function themeFor(mode: ThemeMode): Theme {
  return resolveDark(mode) ? webDarkTheme : webLightTheme
}

/**
 * 订阅当前主题。
 * 返回 Fluent 主题对象，以及"当前实际是不是深色"。
 */
export function useTheme(mode: ThemeMode): { theme: Theme; isDark: boolean } {
  const [isDark, setIsDark] = useState(() => resolveDark(mode))

  // 设置项变化时立刻更新
  useEffect(() => {
    setIsDark(resolveDark(mode))
  }, [mode])

  // 跟随设备时，监听系统主题变化
  useEffect(() => {
    if (mode !== 'system') return

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent): void => setIsDark(event.matches)

    query.addEventListener('change', handler)
    return () => query.removeEventListener('change', handler)
  }, [mode])

  // 在 <html> 上打标记，供全局 CSS 使用
  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light'
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  }, [isDark])

  return { theme: isDark ? webDarkTheme : webLightTheme, isDark }
}
