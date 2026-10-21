import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 点语料标签上的叉，不能把编辑窗口一起弹出来。
 *
 * 【原来的毛病】
 * 语料标签外层绑了 onClick（打开编辑窗口），删除按钮是它的子元素。
 * React 的事件会冒泡，点叉时先触发删除，再冒泡到外层 → 编辑窗口也开了。
 *
 * 0.2.0 起，音频文件标签的外层也有 onClick（打开转录窗口），
 * 所以文件删除按钮也加了同样的拦截。
 *
 * 【修法】
 * 删除按钮的 onClick 里加 event.stopPropagation()。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

const bar = read('src/renderer/components/ResourceBar.tsx')

describe('删除语料不会顺带打开编辑窗口', () => {
  it('删除按钮阻止事件冒泡', () => {
    expect(bar).toContain('event.stopPropagation()')
  })

  it('阻止冒泡发生在删除之前', () => {
    const i = bar.indexOf('event.stopPropagation()')
    const j = bar.search(/requestDelete\(\s*corpus\.id/)
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(i)
  })

  it('文件删除按钮也阻止冒泡（音频标签现在可点击）', () => {
    const i = bar.indexOf("requestDelete(file.id, file.name, 'file')")
    expect(i).toBeGreaterThan(-1)
    const before = bar.slice(Math.max(0, i - 300), i)
    expect(before).toContain('event.stopPropagation()')
  })

  it('语料标签外层仍然可以点击编辑（没把功能改坏）', () => {
    expect(bar).toContain("new CustomEvent('preface:edit-corpus'")
  })

  it('删除按钮依然不参与拖拽', () => {
    // 拖删除按钮不该把语料拖出去
    const count = (bar.match(/draggable=\{false\}/g) ?? []).length
    expect(count).toBe(2)
  })
})

describe('两个标签的删除按钮行为一致', () => {
  it('文件和语料都走 requestDelete，会先检查是否被引用', () => {
    const calls = bar.match(/requestDelete\(/g) ?? []
    // 文件和语料各一个调用点（定义那行是 `requestDelete = (`，不匹配）
    expect(calls.length).toBe(2)
    expect(bar).toContain("requestDelete(file.id, file.name, 'file')")
    expect(bar).toMatch(/requestDelete\(\s*corpus\.id/)
  })

  it('被引用时弹确认框，说明引用了几次', () => {
    expect(bar).toContain("t('resource.deleteBody'")
  })
})
