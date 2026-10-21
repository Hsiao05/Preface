import type { UiLanguage } from './i18n'

/**
 * 翻译目标语言。
 *
 * 预设注入规范的英文名，避免中文界面和英文界面产生不同的目标描述；
 * 自定义目标在清理后原样注入。
 */

export interface TranslationLanguage {
  id: string
  zhName: string
  enName: string
  promptName: string
}

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  { id: 'en', zhName: '英语', enName: 'English', promptName: 'English' },
  { id: 'fr', zhName: '法语', enName: 'French', promptName: 'French' },
  { id: 'de', zhName: '德语', enName: 'German', promptName: 'German' },
  { id: 'es', zhName: '西班牙语', enName: 'Spanish', promptName: 'Spanish' },
  { id: 'pt', zhName: '葡萄牙语', enName: 'Portuguese', promptName: 'Portuguese' },
  { id: 'ja', zhName: '日语', enName: 'Japanese', promptName: 'Japanese' },
  { id: 'ko', zhName: '韩语', enName: 'Korean', promptName: 'Korean' },
  { id: 'it', zhName: '意大利语', enName: 'Italian', promptName: 'Italian' }
]

export const DEFAULT_TRANSLATION_TARGET = 'en'

/** 清理用户输入：单行、去控制字符、限长；空值回退到默认目标 */
export function sanitizeTranslationTarget(value: string): string {
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim()
  return cleaned === '' ? DEFAULT_TRANSLATION_TARGET : cleaned
}

function findPreset(value: string): TranslationLanguage | undefined {
  const cleaned = sanitizeTranslationTarget(value)
  return TRANSLATION_LANGUAGES.find((language) => language.id === cleaned)
}

/** 界面显示用的语言名 */
export function translationLanguageLabel(value: string, ui: UiLanguage): string {
  const cleaned = sanitizeTranslationTarget(value)
  const preset = findPreset(cleaned)
  if (preset) return ui === 'en' ? preset.enName : preset.zhName
  return cleaned
}

/** 注入提示词用的规范名称 */
export function translationPromptName(value: string): string {
  const cleaned = sanitizeTranslationTarget(value)
  return findPreset(cleaned)?.promptName ?? cleaned
}
