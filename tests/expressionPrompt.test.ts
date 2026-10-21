import { describe, expect, it } from 'vitest'
import {
  buildExpressionMessages,
  buildExpressionSystemPrompt
} from '../src/shared/buildMessages'
import { BUILTIN_TEMPLATES } from '../src/shared/prompts/templates'

/**
 * 优化表达的提示词。
 *
 * 这是"保持用户本人声音"的改写，不是提示词优化：
 * 附加要求生效，但不套用表达风格和风格样本。
 */

describe('内置优化表达模板', () => {
  it('只做词句润色，明确冻结结构、顺序和语气', () => {
    const template = BUILTIN_TEMPLATES.expression
    expect(template).toContain('只改词句，不改结构')
    expect(template).toContain('不得新增分段')
    expect(template).toContain('不调整句子顺序')
    expect(template).toContain('不合并或拆分句子')
    expect(template).toContain('删口水词')
    expect(template).toContain('精确用词')
    expect(template).toContain('保留语气和立场')
    expect(template).toContain('只输出润色后的正文')
  })

  it('不再要求结论先行或拆句合句', () => {
    const template = BUILTIN_TEMPLATES.expression
    expect(template).not.toContain('先说结论')
    expect(template).not.toContain('长句拆开')
    expect(template).not.toContain('短句合并')
  })

  it('保留 /命令 和 @编号', () => {
    const template = BUILTIN_TEMPLATES.expression
    expect(template).toContain('/命令')
    expect(template).toContain('@编号')
  })

  it('示例覆盖口语化的原文，结果没有分点', () => {
    const template = BUILTIN_TEMPLATES.expression
    expect(template).toContain('那个，我想说一下')
    expect(template).not.toMatch(/结果：\s*1\./)
  })
})

describe('附加要求', () => {
  it('有附加要求时追加到系统提示词末尾', () => {
    const prompt = buildExpressionSystemPrompt({
      overrides: { extra: '不要用感叹号。' }
    })
    expect(prompt).toContain('用户的附加要求：不要用感叹号。')
    expect(prompt.indexOf('用户的附加要求')).toBeGreaterThan(
      prompt.indexOf('只输出优化后的文字')
    )
  })

  it('附加要求为空时不追加', () => {
    expect(buildExpressionSystemPrompt({ overrides: { extra: '   ' } })).toBe(
      BUILTIN_TEMPLATES.expression
    )
  })
})

describe('用户改过的优化表达模板', () => {
  it('覆盖项优先于内置模板', () => {
    const prompt = buildExpressionSystemPrompt({
      overrides: { templates: { expression: '只改标点。' } }
    })
    expect(prompt).toBe('只改标点。')
  })
})

describe('不套用表达风格', () => {
  it('风格与风格样本不会进入优化表达', () => {
    const messages = buildExpressionMessages('原文', {
      overrides: {
        styles: { 'clear-direct': '这段风格文字不应出现' },
        styleSamples: { 'clear-direct': ['这段样本不应出现'] }
      }
    })
    expect(messages[0].content).not.toContain('这段风格文字不应出现')
    expect(messages[0].content).not.toContain('这段样本不应出现')
  })

  it('消息结构：system 是提示词，user 是原文', () => {
    const messages = buildExpressionMessages('帮我改一下', {})
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: '帮我改一下' })
  })
})
