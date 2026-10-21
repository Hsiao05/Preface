import { BLOCK_META } from './prompts/blocks'
import { TEMPLATE_META } from './prompts/templates'
import { BUILTIN_STYLES } from './prompts/styles'
import { normalizePromptTitle, UNNAMED_PROMPT } from './promptLibrary'
import type { MessageKey, TFunction } from './i18n'

/** 内置块、模板和风格的显示名。用户自建的项始终显示存储里的名字。 */
const BUILTIN_NAME_KEYS: Record<string, MessageKey> = (() => {
  const keys: Record<string, MessageKey> = {}
  for (const meta of BLOCK_META) keys[meta.id] = meta.nameKey
  for (const meta of TEMPLATE_META) keys[meta.id] = meta.nameKey
  for (const style of BUILTIN_STYLES) keys[style.id] = style.nameKey
  keys.extra = 'builtin.extra'
  return keys
})()

export function displayBuiltinName(id: string, fallback: string, t: TFunction): string {
  const key = BUILTIN_NAME_KEYS[id]
  return key ? t(key) : fallback
}

export function isBuiltinNameKey(id: string): boolean {
  return BUILTIN_NAME_KEYS[id] !== undefined
}

/** 空标题在界面上按当前语言显示，存储里仍用中文哨兵值。 */
export function displayPromptTitle(raw: string, t: TFunction): string {
  const title = normalizePromptTitle(raw)
  return title === UNNAMED_PROMPT ? t('prompt.untitled') : title
}
