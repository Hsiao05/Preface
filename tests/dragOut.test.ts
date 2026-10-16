import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 「全部拖出」要真的能拖。
 *
 * 【原来的毛病】
 * 那个按钮是 Fluent 的 Button，用的是 onClick。
 * 但 webContents.startDrag 只是"接管当前这次拖动"，它不会自己发起拖动 ——
 * 拖动会话只有真实的拖拽手势才会产生。点击不产生拖动会话，
 * 于是 startDrag 拿到一个空的接管对象，什么都不发生。
 * 表现就是：按下去拖，没有任何反应。
 *
 * 【修法】
 * 把它改成真正的拖动源：div + draggable + onDragStart，
 * 在 dragstart 里同步调用 startDrag。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

const dialog = read('src/renderer/components/UploadListDialog.tsx')

describe('全部拖出是拖动源，不是按钮', () => {
  it('用 onDragStart 触发，不用 onClick', () => {
    expect(dialog).toContain('onDragStart={(event) => beginDragOut(event, files.map((f) => f.path))}')
  })

  it('元素设了 draggable', () => {
    expect(dialog).toContain('draggable={files.length > 0}')
  })

  it('没有文件时不可拖', () => {
    // draggable 和文件数量绑定，空清单拖不出东西
    expect(dialog).toContain('files.length > 0')
  })

  it('不再是 Fluent 的 Button（button 拖不起来）', () => {
    // 找那个拖动源元素本身：role="button" 那个 div 的起始处
    const start = dialog.indexOf('role="button"')
    expect(start).toBeGreaterThan(-1)

    const element = dialog.slice(start, start + 400)
    expect(element).toContain('onDragStart')
    expect(element).toContain('draggable')
    // 它是个 div，不是 <Button
    const before = dialog.slice(Math.max(0, start - 200), start)
    expect(before).toContain('<div')
    expect(before).not.toContain('<Button')
  })
})

describe('拖出时把全部文件一起带上', () => {
  it('传的是完整的路径数组', () => {
    expect(dialog).toContain('files.map((f) => f.path)')
  })

  it('单个文件那行也走同一条路径', () => {
    expect(dialog).toContain('beginDragOut(event, [file.path])')
  })

  it('主进程把整个数组交给 startDrag 的 files 字段', () => {
    const files = read('src/main/files.ts')
    const i = files.indexOf('export function startDrag')
    const body = files.slice(i, i + 400)
    expect(body).toContain('files: paths')
    // file 字段留第一个即可，files 会覆盖它
    expect(body).toContain('file: paths[0]')
  })

  it('空数组直接返回，不去碰 startDrag', () => {
    const files = read('src/main/files.ts')
    const i = files.indexOf('export function startDrag')
    expect(files.slice(i, i + 200)).toContain('if (paths.length === 0) return')
  })
})

describe('dragstart 里先 preventDefault', () => {
  it('取消浏览器自己的拖动，换成系统的原生文件拖动', () => {
    const i = dialog.indexOf('const beginDragOut')
    const body = dialog.slice(i, i + 400)
    expect(body).toContain('event.preventDefault()')
    // 顺序要对：先取消默认行为，再交给 startDrag
    expect(body.indexOf('event.preventDefault()')).toBeLessThan(body.indexOf('dragOut(paths)'))
  })
})

/**
 * 主进程那一半：真的调用一次 startDrag，看它交给 Electron 的是什么。
 *
 * 上面几条只是"源码里写了这几个字"，这条是真跑一遍逻辑 ——
 * files 字段有没有带全、空数组会不会误调，只有真调用才拦得住。
 */
describe('主进程 startDrag 的行为', () => {
  it('把整个路径数组交给 Electron，file 用第一个兜底', async () => {
    const { startDrag } = await import('../src/main/files')
    const calls: unknown[] = []
    const win = {
      webContents: { startDrag: (opts: unknown) => calls.push(opts) }
    } as unknown as Parameters<typeof startDrag>[0]

    startDrag(win, ['C:/a/1.txt', 'C:/a/2.txt', 'C:/a/3.txt'], 'C:/icon.png')

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      file: 'C:/a/1.txt',
      files: ['C:/a/1.txt', 'C:/a/2.txt', 'C:/a/3.txt'],
      icon: 'C:/icon.png'
    })
  })

  it('空数组直接返回，不碰 Electron（否则会报错）', async () => {
    const { startDrag } = await import('../src/main/files')
    let touched = false
    const win = {
      webContents: { startDrag: () => { touched = true } }
    } as unknown as Parameters<typeof startDrag>[0]

    startDrag(win, [], 'C:/icon.png')

    expect(touched).toBe(false)
  })
})
