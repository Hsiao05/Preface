import { describe, expect, it } from 'vitest'
import { allocateIds, allocateOneId } from '../src/shared/allocateId'
import type { CorpusResource, FileResource } from '../src/shared/types'

function file(id: string, name = `${id}.docx`): FileResource {
  return {
    id,
    name,
    path: `C:\\资料\\${name}`,
    ext: 'docx',
    size: 100,
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

/** 构造分配输入 */
function input(over: {
  files?: FileResource[]
  corpora?: CorpusResource[]
  intentText?: string
  nextFileNo?: number
  nextCorpusNo?: number
}): Parameters<typeof allocateIds>[0] {
  return {
    files: over.files ?? [],
    corpora: over.corpora ?? [],
    intentText: over.intentText ?? '',
    nextFileNo: over.nextFileNo ?? 1,
    nextCorpusNo: over.nextCorpusNo ?? 1
  }
}

describe('首次分配', () => {
  it('空草稿从 F1 开始', () => {
    const result = allocateIds(input({}), 'file', 1)
    expect(result.fileIds).toEqual(['F1'])
    expect(result.nextFileNo).toBe(2)
  })

  it('一次分配多个按顺序排', () => {
    const result = allocateIds(input({}), 'file', 3)
    expect(result.fileIds).toEqual(['F1', 'F2', 'F3'])
    expect(result.nextFileNo).toBe(4)
  })

  it('语料从 C1 开始', () => {
    const result = allocateIds(input({}), 'corpus', 1)
    expect(result.corpusIds).toEqual(['C1'])
    expect(result.nextCorpusNo).toBe(2)
  })

  it('文件和语料各自独立编号', () => {
    const state = input({ files: [file('F1')], corpora: [corpus('C1')] })
    const f = allocateIds(state, 'file', 1)
    const c = allocateIds(state, 'corpus', 1)
    expect(f.fileIds).toEqual(['F2'])
    expect(c.corpusIds).toEqual(['C2'])
  })
})

describe('编号复用（用户要求的机制）', () => {
  it('删掉 F1 且原文不再引用它时，新文件重新用 F1', () => {
    // 现状：只有一个 F2（F1 被删了），原文里也没提 @F1
    const state = input({ files: [file('F2')], intentText: '请修改 @F2。', nextFileNo: 3 })
    const result = allocateIds(state, 'file', 1)
    expect(result.fileIds).toEqual(['F1'])
  })

  it('原文还引用着 F1 时，编号不释放', () => {
    // F1 的资料被删了，但原文里还留着 @F1（失效引用）
    const state = input({ files: [file('F2')], intentText: '请修改 @F1。', nextFileNo: 3 })
    const result = allocateIds(state, 'file', 1)

    // 不能用 F1，否则那条失效引用会悄悄指向一份新资料
    expect(result.fileIds).not.toContain('F1')
    expect(result.fileIds).toEqual(['F3'])
  })

  it('引用一旦从原文删掉，编号就可以复用了', () => {
    const withRef = input({ files: [], intentText: '请修改 @F1。', nextFileNo: 2 })
    expect(allocateIds(withRef, 'file', 1).fileIds).toEqual(['F2'])

    // 用户把 @F1 从原文删掉了
    const withoutRef = input({ files: [], intentText: '请修改。', nextFileNo: 2 })
    expect(allocateIds(withoutRef, 'file', 1).fileIds).toEqual(['F1'])
  })

  it('中间的编号被释放时优先用小的', () => {
    // 有 F1 和 F3，F2 空着
    const state = input({ files: [file('F1'), file('F3')], nextFileNo: 4 })
    const result = allocateIds(state, 'file', 1)
    expect(result.fileIds).toEqual(['F2'])
  })

  it('一次加多个时，优先把空出来的编号都填满', () => {
    // 有 F1、F4，F2 和 F3 空着
    const state = input({ files: [file('F1'), file('F4')], nextFileNo: 5 })
    const result = allocateIds(state, 'file', 3)
    expect(result.fileIds).toEqual(['F2', 'F3', 'F5'])
  })

  it('语料编号同样会复用', () => {
    const state = input({ corpora: [corpus('C3')], intentText: '参考 @C3。', nextCorpusNo: 4 })
    const result = allocateIds(state, 'corpus', 1)
    expect(result.corpusIds).toEqual(['C1'])
  })

  it('@C1 不会被误认为 @C10 已引用', () => {
    // 原文引用的是 C10，不该阻止 C1 被复用
    const state = input({ corpora: [corpus('C10')], intentText: '参考 @C10。' })
    const result = allocateIds(state, 'corpus', 1)
    expect(result.corpusIds).toEqual(['C1'])
  })
})

describe('nextFileNo 的推进', () => {
  it('复用编号后，nextFileNo 不倒退', () => {
    const state = input({ files: [file('F5')], nextFileNo: 6 })
    const result = allocateIds(state, 'file', 1)
    expect(result.fileIds).toEqual(['F1']) // 复用了 F1
    expect(result.nextFileNo).toBe(6) // 但仍然记着 F5 用过
  })

  it('引用里出现的编号也算已用（防止撞号）', () => {
    const state = input({ files: [], intentText: '@F7', nextFileNo: 1 })
    const result = allocateIds(state, 'file', 1)
    // 分配的是 F1，但 nextFileNo 要知道 F7 被引用过
    expect(result.fileIds).toEqual(['F1'])
    expect(result.nextFileNo).toBeGreaterThanOrEqual(2)
  })
})

describe('allocateOneId 便捷函数', () => {
  it('返回单个编号和更新后的计数器', () => {
    const result = allocateOneId(input({}), 'corpus')
    expect(result.id).toBe('C1')
    expect(result.nextCorpusNo).toBe(2)
  })

  it('文件走文件编号', () => {
    const result = allocateOneId(input({ files: [file('F1')] }), 'file')
    expect(result.id).toBe('F2')
  })
})

describe('边界情况', () => {
  it('分配 0 个时什么都不做', () => {
    const result = allocateIds(input({ files: [file('F1')], nextFileNo: 2 }), 'file', 0)
    expect(result.fileIds).toEqual([])
    expect(result.nextFileNo).toBe(2)
  })

  it('编号不连续也不会出错', () => {
    const state = input({
      files: [file('F1'), file('F3'), file('F10')],
      intentText: '@F1 @F3 @F10',
      nextFileNo: 11
    })
    const result = allocateIds(state, 'file', 2)
    // F2 是空的，可以用；F4 也是空的
    expect(result.fileIds).toEqual(['F2', 'F4'])
  })

  it('原文里同时引用文件和语料时不互相干扰', () => {
    const state = input({
      files: [file('F1')],
      corpora: [corpus('C1')],
      intentText: '参考 @F1 和 @C1',
      nextFileNo: 2,
      nextCorpusNo: 2
    })
    const f = allocateIds(state, 'file', 1)
    const c = allocateIds(state, 'corpus', 1)
    expect(f.fileIds).toEqual(['F2'])
    expect(c.corpusIds).toEqual(['C2'])
  })
})
