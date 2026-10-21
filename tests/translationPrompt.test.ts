import { describe, expect, it } from 'vitest'
import {
  buildTranslateMessages,
  buildTranslateSystemPrompt
} from '../src/shared/buildMessages'
import { BUILTIN_TEMPLATES } from '../src/shared/prompts/templates'

/**
 * 翻译提示词。
 *
 * 目标语言必须真正进入系统提示词；用户删掉占位符时仍要兜底补上，
 * 否则模型不知道翻成什么语言。
 */

describe('内置翻译模板', () => {
  it('包含忠实、保留命令和格式、不解释等要求', () => {
    const template = BUILTIN_TEMPLATES.translate
    expect(template).toContain('忠实')
    expect(template).toContain('不增删')
    expect(template).toContain('/')
    expect(template).toContain('@')
    expect(template).toContain('代码')
    expect(template).toContain('格式')
    expect(template).toContain('不要输出任何解释')
    expect(template).toContain('{{target_language}}')
  })

  it('不追加风格样本或附加要求', () => {
    const prompt = buildTranslateSystemPrompt({
      target: 'en',
      overrides: { extra: '尽量口语化', styleSamples: { 'clear-direct': ['样本'] } }
    })
    expect(prompt).not.toContain('尽量口语化')
    expect(prompt).not.toContain('样本')
  })
})

describe('目标语言植入', () => {
  it('预设语言注入规范英文名', () => {
    expect(buildTranslateSystemPrompt({ target: 'en' })).toContain('翻译成English')
    expect(buildTranslateSystemPrompt({ target: 'fr' })).toContain('翻译成French')
    expect(buildTranslateSystemPrompt({ target: 'ja' })).toContain('翻译成Japanese')
  })

  it('自定义语言原样注入（清理为单行）', () => {
    const prompt = buildTranslateSystemPrompt({ target: '  俄语\n  ' })
    expect(prompt).toContain('翻译成俄语')
    expect(prompt).not.toContain('{{target_language}}')
  })

  it('空目标回退到英语', () => {
    expect(buildTranslateSystemPrompt({ target: '   ' })).toContain('翻译成English')
  })

  it('模板里的每一处占位符都被替换', () => {
    const prompt = buildTranslateSystemPrompt({ target: 'de' })
    expect(prompt).not.toContain('{{target_language}}')
    expect(prompt.match(/German/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('用户改过的翻译模板', () => {
  it('覆盖项优先于内置模板', () => {
    const prompt = buildTranslateSystemPrompt({
      target: 'fr',
      overrides: { templates: { translate: 'Translate into {{target_language}} only.' } }
    })
    expect(prompt).toBe('Translate into French only.')
  })

  it('删掉占位符时在末尾补目标语言', () => {
    const prompt = buildTranslateSystemPrompt({
      target: 'ko',
      overrides: { templates: { translate: '请翻译下面的内容。' } }
    })
    expect(prompt).toContain('请翻译下面的内容。')
    expect(prompt).toContain('Target language: Korean')
  })
})

describe('消息结构', () => {
  it('system 是提示词，user 是原文本身', () => {
    const messages = buildTranslateMessages('Hello @F1 /review', { target: 'ja' })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('Japanese')
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello @F1 /review' })
  })
})
