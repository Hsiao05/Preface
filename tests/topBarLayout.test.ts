import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 顶栏布局：按钮文字不能被压到换行。
 *
 * 【原来的毛病】窗口默认 700 宽时，「上传文件」「粘贴语料」在 flex 里被压扁，
 * Fluent 按钮的文字折成两行，顶栏高度跟着跳。窗口加宽到 880 之外，按钮本身
 * 也要声明不换行，否则用户把窗口拖窄又会复发。
 */

const root = join(__dirname, '..')
const topbar = readFileSync(join(root, 'src/renderer/components/TopBar.tsx'), 'utf-8')

describe('顶栏按钮不换行', () => {
  it('两个操作按钮都用了 actionButton 样式', () => {
    const count = (topbar.match(/className=\{styles\.actionButton\}/g) ?? []).length
    expect(count).toBe(2)
  })

  it('actionButton 声明 whiteSpace: nowrap 且不参与收缩', () => {
    const style = topbar.slice(
      topbar.indexOf('actionButton: {'),
      topbar.indexOf('field: {')
    )
    expect(style).toContain("whiteSpace: 'nowrap'")
    expect(style).toContain('flexShrink: 0')
  })

  it('窗口更窄时整组换行，而不是把内容挤出可视区', () => {
    const bar = topbar.slice(topbar.indexOf('bar: {'), topbar.indexOf('spacer: {'))
    expect(bar).toContain("flexWrap: 'wrap'")
  })
})

describe('默认窗口宽度', () => {
  it('默认宽度是 850', async () => {
    const source = readFileSync(join(root, 'src/main/windowState.ts'), 'utf-8')
    expect(source).toContain('export const DEFAULT_WIDTH = 850')
  })
})
