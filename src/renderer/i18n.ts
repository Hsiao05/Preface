import { useMemo } from 'react'
import { translate, type TFunction, type UiLanguage } from '../shared/i18n'
import { useStore } from './store'

/** 渲染进程的界面文案函数，订阅界面语言。 */
export function useT(): TFunction {
  const language = useStore((s) => s.uiLanguage)
  return useMemo(
    () => (key, params) => translate(language, key, params),
    [language]
  )
}

/** 当前界面语言，用于 Intl 数字/日期格式化。 */
export function useUiLanguage(): UiLanguage {
  return useStore((s) => s.uiLanguage)
}
