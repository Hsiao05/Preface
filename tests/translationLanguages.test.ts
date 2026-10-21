import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRANSLATION_TARGET,
  TRANSLATION_LANGUAGES,
  sanitizeTranslationTarget,
  translationLanguageLabel,
  translationPromptName
} from '../src/shared/translationLanguages'

describe('翻译目标语言', () => {
  it('有八个预设，默认英语', () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(8)
    expect(DEFAULT_TRANSLATION_TARGET).toBe('en')
  })

  it('预设同时有中英文名称和规范提示词名', () => {
    for (const language of TRANSLATION_LANGUAGES) {
      expect(language.zhName.trim()).not.toBe('')
      expect(language.enName.trim()).not.toBe('')
      expect(language.promptName.trim()).not.toBe('')
    }
  })
})

describe('清理用户输入', () => {
  it('去掉首尾空白和连续空白', () => {
    expect(sanitizeTranslationTarget('  俄 语  ')).toBe('俄 语')
  })

  it('控制字符换成空格，保持单行', () => {
    expect(sanitizeTranslationTarget('俄\n语\t')).toBe('俄 语')
  })

  it('超长输入截到 60 个字符', () => {
    expect(sanitizeTranslationTarget('a'.repeat(100))).toHaveLength(60)
  })

  it('空值回退到英语', () => {
    expect(sanitizeTranslationTarget('')).toBe('en')
    expect(sanitizeTranslationTarget('   ')).toBe('en')
  })
})

describe('界面显示名', () => {
  it('预设跟随界面语言', () => {
    expect(translationLanguageLabel('fr', 'zh')).toBe('法语')
    expect(translationLanguageLabel('fr', 'en')).toBe('French')
  })

  it('自定义语言原样显示', () => {
    expect(translationLanguageLabel('粤语', 'zh')).toBe('粤语')
    expect(translationLanguageLabel('粤语', 'en')).toBe('粤语')
  })

  it('空值按默认英语显示', () => {
    expect(translationLanguageLabel('', 'zh')).toBe('英语')
  })
})

describe('注入提示词的名称', () => {
  it('预设用规范英文名，不随界面语言变化', () => {
    expect(translationPromptName('ja')).toBe('Japanese')
    expect(translationPromptName('pt')).toBe('Portuguese')
  })

  it('自定义语言清理后原样注入', () => {
    expect(translationPromptName('  粤语  ')).toBe('粤语')
  })
})
