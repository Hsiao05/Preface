import { describe, expect, it } from 'vitest'
import { findUnknownRefRanges, validateRefs } from '../src/shared/validateRefs'
import type { CorpusResource, FileResource } from '../src/shared/types'

function file(id: string): FileResource {
  return {
    id,
    name: `${id}.docx`,
    path: `C:\\资料\\${id}.docx`,
    ext: 'docx',
    size: 100,
    mtime: 1760000000000,
    note: '',
    permission: 'editable'
  }
}

function corpus(id: string): CorpusResource {
  return {
    id,
    title: '语料',
    titleSource: 'user',
    content: '内容',
    chars: 2,
    createdAt: 1760000000000
  }
}

const FILES = [file('F1'), file('F2')]
const CORPORA = [corpus('C1')]

describe('引用都正确时', () => {
  it('校验通过', () => {
    const result = validateRefs({
      source: '请修改 @F1，参考 @C1。',
      result: '请修改 @F1，参考 @C1。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.unknown).toEqual([])
    expect(result.remedyMessage).toBe('')
  })

  it('原文没有引用、结果也没有引用时通过', () => {
    const result = validateRefs({
      source: '请随便看看。',
      result: '请随便看看。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(true)
  })

  it('结果里引用出现多次也算通过', () => {
    const result = validateRefs({
      source: '请修改 @F1。',
      result: '请修改 @F1，改完 @F1 之后再说。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(true)
  })
})

describe('缺少引用', () => {
  it('原文有 @F2 但结果里没有时报告', () => {
    const result = validateRefs({
      source: '请修改 @F1 和 @F2。',
      result: '请修改 @F1。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['@F2'])
    expect(result.remedyMessage).toContain('结果中缺少 @F2')
    expect(result.remedyMessage).toContain('重新输出【结果】')
  })

  it('缺多个时全部列出', () => {
    const result = validateRefs({
      source: '请修改 @F1、@F2 和 @C1。',
      result: '请修改。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.missing).toEqual(['@F1', '@F2', '@C1'])
  })
})

describe('多出不存在的编号', () => {
  it('结果里有 @F9 时报告', () => {
    const result = validateRefs({
      source: '请修改 @F1。',
      result: '请修改 @F1，同时参考 @F9。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(false)
    expect(result.unknown).toEqual(['@F9'])
    expect(result.remedyMessage).toContain('结果中出现了不存在的 @F9')
  })

  it('引用了清单里没有的语料也报告', () => {
    const result = validateRefs({
      source: '请修改 @F1。',
      result: '请修改 @F1，参考 @C5。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.unknown).toEqual(['@C5'])
  })
})

describe('缺少和多出同时出现', () => {
  it('两个问题都报出来', () => {
    const result = validateRefs({
      source: '请修改 @F1 和 @F2。',
      result: '请修改 @F1 和 @F5。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.missing).toEqual(['@F2'])
    expect(result.unknown).toEqual(['@F5'])
    expect(result.remedyMessage).toContain('缺少 @F2')
    expect(result.remedyMessage).toContain('不存在的 @F5')
  })
})

describe('同一编号出现多次', () => {
  it('出现多次不影响校验', () => {
    const result = validateRefs({
      source: '请修改 @F1。',
      result: '请修改 @F1。改完 @F1 后告诉我。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(true)
  })

  it('原文里 @F1 出现多次、结果里只有一次时，算通过', () => {
    const result = validateRefs({
      source: '请修改 @F1，改完 @F1 再检查 @F1。',
      result: '请修改 @F1。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(true)
  })
})

describe('边界情况', () => {
  it('@F1 不会被 @F12 误判', () => {
    const files = [file('F1'), file('F12')]
    const result = validateRefs({
      source: '请修改 @F12。',
      result: '请修改 @F12。',
      files,
      corpora: []
    })
    // 原文引用的是 F12，结果也引用 F12，通过
    expect(result.ok).toBe(true)
    // 不应该把 F1 算成缺失
    expect(result.missing).toEqual([])
  })

  it('清单为空时，结果里任何引用都算"多出"', () => {
    const result = validateRefs({
      source: '请修改 @F1。',
      result: '请修改 @F1。',
      files: [],
      corpora: []
    })
    expect(result.unknown).toEqual(['@F1'])
    // 原文和结果都有 @F1，所以不算"缺失" —— 缺的是"清单里没有这份资料"
    expect(result.missing).toEqual([])
  })

  it('结果为空时，原文的所有引用都算缺失', () => {
    const result = validateRefs({
      source: '请修改 @F1。',
      result: '',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.missing).toEqual(['@F1'])
  })

  it('不带数字的 @ 不算引用', () => {
    const result = validateRefs({
      source: '请 @所有人 注意。',
      result: '请 @所有人 注意。',
      files: FILES,
      corpora: CORPORA
    })
    expect(result.ok).toBe(true)
  })
})

describe('找出失效引用的位置（用于标黄）', () => {
  it('返回起止位置', () => {
    const text = '请修改 @F1，参考 @F9。'
    const ranges = findUnknownRefRanges(text, new Set(['F1']))
    expect(ranges).toHaveLength(1)
    expect(ranges[0].ref).toBe('@F9')
    expect(text.slice(ranges[0].start, ranges[0].end)).toBe('@F9')
  })

  it('全部有效时返回空数组', () => {
    const ranges = findUnknownRefRanges('请修改 @F1。', new Set(['F1']))
    expect(ranges).toEqual([])
  })

  it('多个失效引用都找出来', () => {
    const ranges = findUnknownRefRanges('@F1 @F9 @C1 @C7', new Set(['F1', 'C1']))
    expect(ranges.map((r) => r.ref)).toEqual(['@F9', '@C7'])
  })
})
