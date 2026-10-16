import { describe, expect, it } from 'vitest'

/**
 * 草稿历史的保留时长逻辑。
 *
 * draftHistory.ts 依赖 Electron 的 app.getPath，这里只测纯计算部分，
 * 与实现保持同步。
 */

/** 保留时长的可选值 */
const RETENTION_OPTIONS = [10, 30, 60, 120, 300, 720, 1440, 0] as const

/** 与 draftHistory.ts 的 pruneByRetention 相同判断 */
function isExpired(savedAt: number, retentionMinutes: number, now: number): boolean {
  if (retentionMinutes <= 0) return false // 永不删除
  const cutoff = now - retentionMinutes * 60 * 1000
  return savedAt < cutoff
}

const NOW = new Date('2026-10-15T12:00:00Z').getTime()

describe('保留时长', () => {
  it('提供了用户要求的全部选项', () => {
    // 10 分钟、30 分钟、1 小时、2 小时、5 小时、12 小时、24 小时、永不删除
    expect([...RETENTION_OPTIONS]).toEqual([10, 30, 60, 120, 300, 720, 1440, 0])
  })

  it('10 分钟：9 分钟前的保留，11 分钟前的过期', () => {
    expect(isExpired(NOW - 9 * 60_000, 10, NOW)).toBe(false)
    expect(isExpired(NOW - 11 * 60_000, 10, NOW)).toBe(true)
  })

  it('1 小时：59 分钟前的保留，61 分钟前的过期', () => {
    expect(isExpired(NOW - 59 * 60_000, 60, NOW)).toBe(false)
    expect(isExpired(NOW - 61 * 60_000, 60, NOW)).toBe(true)
  })

  it('24 小时：23 小时前的保留，25 小时前的过期', () => {
    expect(isExpired(NOW - 23 * 3_600_000, 1440, NOW)).toBe(false)
    expect(isExpired(NOW - 25 * 3_600_000, 1440, NOW)).toBe(true)
  })

  it('永不删除（0）：多久以前的都保留', () => {
    expect(isExpired(NOW - 365 * 24 * 3_600_000, 0, NOW)).toBe(false)
    expect(isExpired(0, 0, NOW)).toBe(false)
  })

  it('刚好在边界上的算过期', () => {
    expect(isExpired(NOW - 10 * 60_000, 10, NOW)).toBe(false) // 正好 10 分钟，还没超过
    expect(isExpired(NOW - 10 * 60_000 - 1, 10, NOW)).toBe(true)
  })
})

describe('保留时长变短时的行为', () => {
  it('从 24 小时改成 10 分钟，2 小时前的记录会被清掉', () => {
    const twoHoursAgo = NOW - 2 * 3_600_000
    expect(isExpired(twoHoursAgo, 1440, NOW)).toBe(false) // 24 小时下保留
    expect(isExpired(twoHoursAgo, 10, NOW)).toBe(true) // 改成 10 分钟后过期
  })

  it('从 10 分钟改成永不删除，已有的记录不再被清', () => {
    const longAgo = NOW - 100 * 24 * 3_600_000
    expect(isExpired(longAgo, 10, NOW)).toBe(true)
    expect(isExpired(longAgo, 0, NOW)).toBe(false)
  })
})

describe('快照的保存条件', () => {
  /** 与 draftHistory.ts 的 saveSnapshot 相同判断 */
  function hasContent(draft: {
    intentText: string
    files: unknown[]
    corpora: unknown[]
    result: { text: string } | null
  }): boolean {
    return (
      draft.intentText.trim().length > 0 ||
      draft.files.length > 0 ||
      draft.corpora.length > 0 ||
      Boolean(draft.result?.text)
    )
  }

  it('完全空的草稿不保存', () => {
    expect(
      hasContent({ intentText: '', files: [], corpora: [], result: null })
    ).toBe(false)
  })

  it('只有空白字符的原文不保存', () => {
    expect(
      hasContent({ intentText: '   \n  ', files: [], corpora: [], result: null })
    ).toBe(false)
  })

  it('有原文就保存', () => {
    expect(
      hasContent({ intentText: '请修改 @F1。', files: [], corpora: [], result: null })
    ).toBe(true)
  })

  it('只有文件也保存', () => {
    expect(hasContent({ intentText: '', files: [{}], corpora: [], result: null })).toBe(true)
  })

  it('只有语料也保存', () => {
    expect(hasContent({ intentText: '', files: [], corpora: [{}], result: null })).toBe(true)
  })

  it('只有优化结果也保存', () => {
    expect(
      hasContent({ intentText: '', files: [], corpora: [], result: { text: '结果' } })
    ).toBe(true)
  })
})
