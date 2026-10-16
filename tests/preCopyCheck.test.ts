import { describe, expect, it } from 'vitest'
import { preCopyCheck } from '../src/shared/preCopyCheck'
import { countRef, findRefs } from '../src/shared/refs'
import type { CorpusResource, FileResource } from '../src/shared/types'

function file(id: string, name = `${id}.docx`): FileResource {
  return {
    id,
    name,
    path: `C:\\资料\\${name}`,
    ext: 'docx',
    size: 1000,
    mtime: 1760000000000,
    note: '',
    permission: 'editable'
  }
}

function corpus(id: string, title = '语料'): CorpusResource {
  return {
    id,
    title,
    titleSource: 'user',
    content: '内容',
    chars: 2,
    createdAt: 1760000000000
  }
}

describe('失效引用检查', () => {
  it('引用了不存在的编号时报告问题', () => {
    const result = preCopyCheck({
      files: [file('F1')],
      corpora: [],
      body: '请参考 @F9。',
      target: 'local'
    })
    expect(result.issues.find((i) => i.kind === 'missing-ref')).toBeDefined()
  })

  it('引用都存在时不报告', () => {
    const result = preCopyCheck({
      files: [file('F1')],
      corpora: [],
      body: '请参考 @F1。',
      target: 'local'
    })
    expect(result.issues.find((i) => i.kind === 'missing-ref')).toBeUndefined()
  })
})

describe('未被引用的资料', () => {
  it('列出未被引用的编号', () => {
    const result = preCopyCheck({
      files: [file('F1'), file('F2')],
      corpora: [corpus('C1')],
      body: '请修改 @F1。',
      target: 'local'
    })
    expect(result.unreferencedIds).toEqual(['F2', 'C1'])
    const issue = result.issues.find((i) => i.kind === 'unreferenced')
    expect(issue?.action).toBe('include-as-background')
  })

  it('全部被引用时没有这个问题', () => {
    const result = preCopyCheck({
      files: [file('F1')],
      corpora: [corpus('C1')],
      body: '请参考 @F1 和 @C1。',
      target: 'local'
    })
    expect(result.unreferencedIds).toEqual([])
    expect(result.issues.find((i) => i.kind === 'unreferenced')).toBeUndefined()
  })
})

describe('文件不存在', () => {
  it('已确认不存在的文件会报告', () => {
    const result = preCopyCheck({
      files: [file('F1'), file('F2')],
      corpora: [],
      body: '请参考 @F1 和 @F2。',
      target: 'local',
      missingFileIds: new Set(['F2'])
    })
    const issue = result.issues.find((i) => i.kind === 'missing-file')
    expect(issue).toBeDefined()
    expect(issue!.detail).toContain('F2')
    expect(issue!.detail).not.toContain('F1 ')
  })
})

describe('长度检查', () => {
  it('超过阈值时报告', () => {
    const result = preCopyCheck({
      files: [],
      corpora: [corpus('C1')],
      body: '甲'.repeat(200),
      target: 'local',
      lengthWarnThreshold: 100
    })
    expect(result.issues.find((i) => i.kind === 'too-long')).toBeDefined()
  })

  it('没超过时不报告', () => {
    const result = preCopyCheck({
      files: [],
      corpora: [],
      body: '短',
      target: 'local',
      lengthWarnThreshold: 100
    })
    expect(result.issues.find((i) => i.kind === 'too-long')).toBeUndefined()
  })
})

describe('网页端重名', () => {
  it('同名文件会报告', () => {
    const result = preCopyCheck({
      files: [file('F1', '报告.docx'), file('F2', '报告.docx')],
      corpora: [],
      body: '请参考 @F1 和 @F2。',
      target: 'web'
    })
    const issue = result.issues.find((i) => i.kind === 'duplicate-name')
    expect(issue).toBeDefined()
    expect(issue!.detail).toContain('报告.docx')
  })

  it('本地 Agent 不检查重名', () => {
    const result = preCopyCheck({
      files: [file('F1', '报告.docx'), file('F2', '报告.docx')],
      corpora: [],
      body: '请参考 @F1 和 @F2。',
      target: 'local'
    })
    expect(result.issues.find((i) => i.kind === 'duplicate-name')).toBeUndefined()
  })
})

describe('引用工具函数', () => {
  it('findRefs 去重并保持出现顺序', () => {
    expect(findRefs('@F2 然后 @F1 再 @F2')).toEqual(['@F2', '@F1'])
  })

  it('countRef 正确计数', () => {
    expect(countRef('@F1 和 @F1 还有 @F1', '@F1')).toBe(3)
  })

  it('countRef 不会把 @F12 算成 @F1', () => {
    expect(countRef('请参考 @F12。', '@F1')).toBe(0)
    expect(countRef('请参考 @F12。', '@F12')).toBe(1)
  })

  it('findRefs 忽略不带数字的 @', () => {
    expect(findRefs('请 @所有人 注意')).toEqual([])
  })

  it('findRefs 识别多位数编号', () => {
    expect(findRefs('@F100 和 @C25')).toEqual(['@F100', '@C25'])
  })
})
