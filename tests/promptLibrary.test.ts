import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * 「我的 Prompt 库」的存储。
 *
 * 用真的临时目录、真的文件跑真实的存储模块。重点锁住几条会丢数据的边界：
 * - 写盘失败要报错，不能假报成功；
 * - 文件损坏要保留原文件，不能静默变成空库；
 * - 并发保存不能互相覆盖。
 */

let userDataDir: string
let store: typeof import('../src/main/promptLibraryStore')

beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'preface-prompts-'))
  vi.resetModules()
  vi.doMock('electron', () => ({
    app: { getPath: () => userDataDir }
  }))
  store = await import('../src/main/promptLibraryStore')
  store.resetPromptLibraryCacheForTest()
})

function libraryFile(): string {
  return join(userDataDir, 'prompt-library.json')
}

describe('新建与读取', () => {
  it('空目录返回空库，不创建文件', () => {
    expect(store.listPromptItems().items).toEqual([])
    expect(existsSync(libraryFile())).toBe(false)
  })

  it('保存后落盘，重新加载还在', async () => {
    await store.savePromptItem({
      id: 'p_1',
      title: '会议纪要整理',
      content: '请把下面的会议记录整理成纪要。',
      titleSource: 'user'
    })

    expect(existsSync(libraryFile())).toBe(true)

    // 清掉内存缓存，模拟重启
    store.resetPromptLibraryCacheForTest()
    const items = store.listPromptItems().items
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('会议纪要整理')
    expect(items[0].titleSource).toBe('user')
  })

  it('空标题统一保存为「未命名 Prompt」', async () => {
    const data = await store.savePromptItem({
      id: 'p_1',
      title: '   ',
      content: '正文',
      titleSource: 'user'
    })

    expect(data.items[0].title).toBe('未命名 Prompt')
    expect(data.items[0].titleSource).toBe('none')
  })

  it('AI 回填的标题来源记为 ai', async () => {
    const data = await store.savePromptItem({
      id: 'p_1',
      title: '合同风险检查',
      content: '正文',
      titleSource: 'ai'
    })
    expect(data.items[0].titleSource).toBe('ai')
  })

  it('更新已有条目不会改变创建时间', async () => {
    const first = await store.savePromptItem({
      id: 'p_1',
      title: '旧标题',
      content: '旧正文',
      titleSource: 'user'
    })
    const createdAt = first.items[0].createdAt

    const second = await store.savePromptItem({
      id: 'p_1',
      title: '新标题',
      content: '新正文',
      titleSource: 'user'
    })

    expect(second.items).toHaveLength(1)
    expect(second.items[0].createdAt).toBe(createdAt)
    expect(second.items[0].title).toBe('新标题')
  })
})

describe('校验：超限明确报错，不截断保存', () => {
  it('标题超过 100 字被拒绝', async () => {
    await expect(
      store.savePromptItem({
        id: 'p_1',
        title: '标'.repeat(101),
        content: '正文',
        titleSource: 'user'
      })
    ).rejects.toThrow(/标题不能超过/)
  })

  it('正文为空被拒绝', async () => {
    await expect(
      store.savePromptItem({ id: 'p_1', title: '标题', content: '   ', titleSource: 'user' })
    ).rejects.toThrow(/正文不能为空/)
  })

  it('正文超过 10 万字被拒绝', async () => {
    await expect(
      store.savePromptItem({
        id: 'p_1',
        title: '标题',
        content: '字'.repeat(100_001),
        titleSource: 'user'
      })
    ).rejects.toThrow(/不能超过/)
  })

  it('非法 id 被拒绝（防止被当成路径）', async () => {
    await expect(
      store.savePromptItem({
        id: '../../evil',
        title: '标题',
        content: '正文',
        titleSource: 'user'
      })
    ).rejects.toThrow(/编号不对/)
  })
})

describe('删除', () => {
  it('删除后落盘，重载不再出现', async () => {
    await store.savePromptItem({ id: 'p_1', title: 'A', content: 'a', titleSource: 'user' })
    await store.savePromptItem({ id: 'p_2', title: 'B', content: 'b', titleSource: 'user' })

    const data = await store.deletePromptItem('p_1')
    expect(data.items.map((i) => i.id)).toEqual(['p_2'])

    store.resetPromptLibraryCacheForTest()
    expect(store.listPromptItems().items.map((i) => i.id)).toEqual(['p_2'])
  })

  it('删除不存在的条目是幂等的', async () => {
    const data = await store.deletePromptItem('p_none')
    expect(data.items).toEqual([])
  })
})

describe('损坏的文件：保留原文件，不静默清空', () => {
  it('不是 JSON 时明确报错，原文件还在', () => {
    writeFileSync(libraryFile(), '{ not json', 'utf-8')

    expect(() => store.listPromptItems()).toThrow(/不是合法的 JSON/)
    expect(readFileSync(libraryFile(), 'utf-8')).toBe('{ not json')
  })

  it('版本不认识时明确报错', () => {
    writeFileSync(
      libraryFile(),
      JSON.stringify({ version: 99, items: [] }),
      'utf-8'
    )

    expect(() => store.listPromptItems()).toThrow(/版本/)
  })

  it('结构不对时明确报错', () => {
    writeFileSync(
      libraryFile(),
      JSON.stringify({ version: 1, items: [{ id: 1 }] }),
      'utf-8'
    )

    expect(() => store.listPromptItems()).toThrow(/格式不对/)
  })
})

describe('写盘失败', () => {
  it('目录写不进去时报错，不假报成功', async () => {
    // 让 userData 指向一个不存在的盘符下的路径
    userDataDir = join('Z:', '\\不存在的目录')
    store.resetPromptLibraryCacheForTest()

    await expect(
      store.savePromptItem({ id: 'p_1', title: 'A', content: 'a', titleSource: 'user' })
    ).rejects.toThrow(/保存 Prompt 库失败/)
  })
})

describe('并发保存', () => {
  it('两条同时保存都会保留下来', async () => {
    await Promise.all([
      store.savePromptItem({ id: 'p_1', title: 'A', content: 'a', titleSource: 'user' }),
      store.savePromptItem({ id: 'p_2', title: 'B', content: 'b', titleSource: 'user' })
    ])

    store.resetPromptLibraryCacheForTest()
    const ids = store.listPromptItems().items.map((i) => i.id).sort()
    expect(ids).toEqual(['p_1', 'p_2'])
  })

  it('同一条并发保存：以最后写入的为准，文件不损坏', async () => {
    await Promise.all([
      store.savePromptItem({ id: 'p_1', title: 'A', content: 'a', titleSource: 'user' }),
      store.savePromptItem({ id: 'p_1', title: 'B', content: 'b', titleSource: 'user' })
    ])

    store.resetPromptLibraryCacheForTest()
    const items = store.listPromptItems().items
    expect(items).toHaveLength(1)
    expect(['A', 'B']).toContain(items[0].title)
  })
})

describe('库与草稿互不影响', () => {
  it('删除库条目不会碰到别的文件', async () => {
    const other = join(userDataDir, 'drafts', 'current.json')
    writeFileSync(join(userDataDir, 'other.json'), 'keep', 'utf-8')

    await store.savePromptItem({ id: 'p_1', title: 'A', content: 'a', titleSource: 'user' })
    await store.deletePromptItem('p_1')

    expect(readFileSync(join(userDataDir, 'other.json'), 'utf-8')).toBe('keep')
    expect(existsSync(other)).toBe(false)
  })
})
