import { describe, expect, it } from 'vitest'
import { stripMarkdown } from '../src/shared/stripMarkdown'

/**
 * "整理完原文被清空"这个 bug 的保护逻辑。
 *
 * 界面在收到整理结果后，会先做 Markdown 兜底清理，再决定要不要覆盖原文。
 * 关键是：清理后为空时绝不能覆盖，否则用户的原文就没了。
 */

/** 与 useLlmRun.ts 里 tidy 的 onDone 相同的判断 */
function shouldOverwrite(rawResult: string): boolean {
  const cleaned = stripMarkdown(rawResult).trim()
  return cleaned.length > 0
}

describe('整理结果为空时不覆盖原文', () => {
  it('完全空的结果不覆盖', () => {
    expect(shouldOverwrite('')).toBe(false)
  })

  it('只有空白字符的结果不覆盖', () => {
    expect(shouldOverwrite('   \n\n  \t ')).toBe(false)
  })

  it('只有换行的结果不覆盖', () => {
    expect(shouldOverwrite('\n\n\n')).toBe(false)
  })

  it('正常内容会覆盖', () => {
    expect(shouldOverwrite('我想做一个小工具。')).toBe(true)
  })

  it('只有 Markdown 符号、清理后为空的结果不覆盖', () => {
    // 全是列表符号和加粗符号，清理后什么都不剩
    expect(shouldOverwrite('- \n- \n')).toBe(false)
    expect(shouldOverwrite('**')).toBe(true) // 单个 ** 不成对，保留
  })

  it('清理后仍有内容时会覆盖', () => {
    expect(shouldOverwrite('# 标题\n- 要点')).toBe(true)
  })
})

describe('整理结果会做 Markdown 兜底清理', () => {
  it('去掉行首标题和列表符号', () => {
    const result = stripMarkdown('# 标题\n- 要点一\n- 要点二')
    expect(result).not.toContain('#')
    expect(result).not.toContain('- ')
    expect(result).toContain('要点一')
  })

  it('保留 @ 引用', () => {
    expect(stripMarkdown('- 请修改 @F1')).toContain('@F1')
  })

  it('保留有序列表编号（文档要求用 1. 2. 3.）', () => {
    const result = stripMarkdown('1. 第一点\n2. 第二点')
    expect(result).toContain('1. 第一点')
    expect(result).toContain('2. 第二点')
  })
})
