import { translate, type MessageKey, type UiLanguage } from '../shared/i18n'
import { loadSettings } from './settings'

/** 主进程的界面文案函数，跟随设置里的界面语言。 */
export function mainT(
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  return translate(loadSettings().uiLanguage, key, params)
}

/** 当前界面语言 */
export function getUiLanguage(): UiLanguage {
  return loadSettings().uiLanguage
}
