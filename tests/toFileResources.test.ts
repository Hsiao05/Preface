import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FileResource } from '../src/shared/types'

/**
 * 加入文件时的编号分配与去重。
 *
 * toFileResources 依赖 Electron 的 dialog/shell，这里把 electron 模块换掉，
 * 只测它的纯逻辑部分。
 */

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  shell: { showItemInFolder: vi.fn() }
}))

const { toFileResources } = await import('../src/main/files')

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'preface-files-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function makeFile(name: string): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, 'x', 'utf-8')
  return path
}

function file(id: string, path: string): FileResource {
  return {
    id,
    name: path.split('\\').pop() ?? id,
    path,
    ext: 'docx',
    size: 1,
    mtime: 1760000000000,
    note: '',
    permission: 'editable'
  }
}

describe('加入文件', () => {
  it('三个文件得到 F1 到 F3', async () => {
    const paths = [await makeFile('a.docx'), await makeFile('b.pdf'), await makeFile('c.txt')]
    const { added, nextNo } = await toFileResources(paths, [], '', 1)
    expect(added.map((f) => f.id)).toEqual(['F1', 'F2', 'F3'])
    expect(nextNo).toBe(4)
  })

  it('重复加入同一文件时只保留一份', async () => {
    const path = await makeFile('dup.docx')
    const { added, skipped } = await toFileResources([path, path, path], [], '', 1)
    expect(added).toHaveLength(1)
    expect(skipped).toHaveLength(2)
  })

  it('已经加过的文件再次拖入时不重复', async () => {
    const path = await makeFile('already.docx')
    const first = await toFileResources([path], [], '', 1)
    const second = await toFileResources([path], first.added, '', first.nextNo)
    expect(second.added).toHaveLength(0)
    expect(second.skipped).toHaveLength(1)
  })

  it('不存在的文件被跳过', async () => {
    const { added, skipped } = await toFileResources([join(dir, '不存在.docx')], [], '', 1)
    expect(added).toHaveLength(0)
    expect(skipped).toHaveLength(1)
  })

  it('路径比较忽略大小写（Windows 不区分）', async () => {
    const path = await makeFile('CaseTest.docx')
    const first = await toFileResources([path], [], '', 1)
    const second = await toFileResources([path.toUpperCase()], first.added, '', first.nextNo)
    expect(second.added).toHaveLength(0)
  })

  it('新加入的文件默认可修改、无用途备注', async () => {
    const path = await makeFile('default.docx')
    const { added } = await toFileResources([path], [], '', 1)
    expect(added[0].permission).toBe('editable')
    expect(added[0].note).toBe('')
  })

  it('一次加多个时，编号连着排', async () => {
    const a = await makeFile('m1.docx')
    const b = await makeFile('m2.docx')
    const existing = [file('F1', join(dir, '已有.docx'))]
    const { added } = await toFileResources([a, b], existing, '', 2)
    expect(added.map((f) => f.id)).toEqual(['F2', 'F3'])
  })
})

describe('编号复用', () => {
  it('删掉的编号且原文没引用时，新文件复用它', async () => {
    const path = await makeFile('reuse.docx')
    // 现状：只有 F2，原文引用 @F2
    const existing = [file('F2', join(dir, '现有.docx'))]
    const { added } = await toFileResources([path], existing, '请修改 @F2。', 3)
    expect(added[0].id).toBe('F1')
  })

  it('原文还引用着这个编号时，不复用', async () => {
    const path = await makeFile('noreuse.docx')
    const existing = [file('F2', join(dir, '现有.docx'))]
    // 原文里还留着失效引用 @F1
    const { added } = await toFileResources([path], existing, '请修改 @F1。', 3)
    expect(added[0].id).not.toBe('F1')
  })

  it('原文引用的是 @F10 时，不影响 F1 被复用', async () => {
    const path = await makeFile('c10.docx')
    const existing = [file('F10', join(dir, '现有.docx'))]
    const { added } = await toFileResources([path], existing, '请修改 @F10。', 11)
    expect(added[0].id).toBe('F1')
  })
})
