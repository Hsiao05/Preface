import { en, zh, type MessageKey } from './catalog'

export type { MessageKey }
export type UiLanguage = 'zh' | 'en'

export type TFunction = (
  key: MessageKey,
  params?: Record<string, string | number>
) => string

/**
 * 取一条界面文案并填入参数。
 *
 * 缺少参数时保留 {name} 原文，方便测试发现漏传，而不是悄悄显示半句话。
 */
export function translate(
  language: UiLanguage,
  key: MessageKey,
  params: Record<string, string | number> = {}
): string {
  const template = language === 'en' ? en[key] : zh[key]
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] === undefined ? match : String(params[name])
  )
}

export { zh, en }
