import { describe, expect, it } from 'vitest'
import { estimateTokens, formatTokenCount } from '../src/shared/estimateTokens'

describe('estimateTokens', () => {
  it('空文本是 0', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('纯中文：字符数 × 0.7', () => {
    // 10 个汉字 → 7
    expect(estimateTokens('一二三四五六七八九十')).toBe(7)
  })

  it('纯英文：字符数 ÷ 4', () => {
    // 8 个字符 → 2
    expect(estimateTokens('abcdefgh')).toBe(2)
  })

  it('中英混合分别计算再相加', () => {
    // 4 个汉字 → 2.8，4 个英文字符 → 1，合计 3.8 → 4
    expect(estimateTokens('你好世界abcd')).toBe(4)
  })

  it('中文标点算作中文', () => {
    const withPunct = estimateTokens('你好，世界。')
    expect(withPunct).toBeGreaterThan(0)
  })

  it('长文本估算值随长度增长', () => {
    const short = estimateTokens('你好')
    const long = estimateTokens('你好'.repeat(100))
    expect(long).toBeGreaterThan(short)
  })

  it('换行和空格按普通字符计算', () => {
    // 4 个换行 ÷ 4 = 1
    expect(estimateTokens('\n\n\n\n')).toBe(1)
  })

  it('结果取整', () => {
    expect(Number.isInteger(estimateTokens('测试一下'))).toBe(true)
  })
})

describe('formatTokenCount', () => {
  it('小于 1000 直接显示', () => {
    expect(formatTokenCount(999)).toBe('999')
  })

  it('大于等于 1000 显示成 k', () => {
    expect(formatTokenCount(1600)).toBe('1.6k')
  })
})
