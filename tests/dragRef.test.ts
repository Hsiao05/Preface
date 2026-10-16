import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 拖拽引用不能出现两个 @F1。
 *
 * 根因：CodeMirror 内置的 drop 处理器会读 dataTransfer 里的纯文本并自己插入一次，
 * 我们再插一次就成了两个。修法是只放自定义类型，不放 text/plain。
 *
 * 这里直接检查源码，确保那个 setData('text/plain', ...) 不再回来。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

describe('拖拽引用的数据类型', () => {
  it('资料标签只放自定义类型，不放 text/plain', () => {
    const source = read('src/renderer/components/ResourceBar.tsx')

    // 必须有自定义类型
    expect(source).toContain("setData('application/x-preface-ref'")

    // 绝不能放 text/plain —— 放了 CodeMirror 就会自己再插一次
    expect(source).not.toContain("setData('text/plain'")
    expect(source).not.toContain('setData("text/plain"')
  })

  it('编辑器读的是自定义类型', () => {
    const source = read('src/renderer/components/IntentEditor.tsx')
    expect(source).toContain("getData('application/x-preface-ref'")
  })

  it('拖拽事件在捕获阶段处理，抢在 CodeMirror 前面', () => {
    const source = read('src/renderer/components/IntentEditor.tsx')
    // addEventListener 的第三个参数为 true 表示捕获阶段
    expect(source).toContain("addEventListener('drop', handleDrop, true)")
    expect(source).toContain("addEventListener('dragover', handleDragOver, true)")
  })

  it('文件拖入的逻辑会跳过内部引用拖拽，两者不打架', () => {
    const source = read('src/renderer/useFileDrop.ts')
    expect(source).toContain("'application/x-preface-ref'")
    // 是内部拖拽时直接返回，不当成"加入文件"
    expect(source).toContain('if (isInternalRefDrag(event)) return')
  })

  it('删除按钮不参与拖拽', () => {
    const source = read('src/renderer/components/ResourceBar.tsx')
    const count = (source.match(/draggable=\{false\}/g) ?? []).length
    // 文件和语料各一个
    expect(count).toBe(2)
  })
})

describe('资料栏自动换行', () => {
  it('用 flexWrap 换行而不是横向滚动', () => {
    const source = read('src/renderer/components/ResourceBar.tsx')
    expect(source).toContain("flexWrap: 'wrap'")
    // 不该再有横向滚动
    expect(source).not.toContain("overflowX: 'auto'")
  })

  it('资料很多时限制高度并纵向滚动，不挤掉编辑区', () => {
    const source = read('src/renderer/components/ResourceBar.tsx')
    expect(source).toContain("overflowY: 'auto'")
    expect(source).toContain('maxHeight')
  })
})

describe('设置窗口只有一个关闭入口', () => {
  it('保留标题栏的关闭按钮', () => {
    const source = read('src/renderer/components/SettingsDialog.tsx')
    expect(source).toContain('aria-label="关闭设置"')
  })

  it('不再有底部的第二个关闭按钮', () => {
    const source = read('src/renderer/components/SettingsDialog.tsx')
    expect(source).not.toContain('DialogActions')
  })
})

describe('测试连接的结果显示在设置窗口里', () => {
  it('设置窗口有自己的提示条', () => {
    const source = read('src/renderer/components/SettingsDialog.tsx')
    expect(source).toContain('MessageBar')
    expect(source).toContain('SettingsNotice')
  })

  it('设置窗口不再借用主窗口的提示条', () => {
    const source = read('src/renderer/components/SettingsDialog.tsx')
    // 不该再从 store 里取 setNotice
    expect(source).not.toContain("useStore((s) => s.setNotice)")
  })
})

describe('顶栏能切换模型配置', () => {
  it('顶栏有模型下拉框', () => {
    const source = read('src/renderer/components/TopBar.tsx')
    expect(source).toContain('switchProfile')
    expect(source).toContain('listProfiles')
    expect(source).toContain('setCurrentProfile')
  })

  it('设置窗口保存后会通知顶栏刷新', () => {
    const settings = read('src/renderer/components/SettingsDialog.tsx')
    expect(settings).toContain("dispatchEvent(new Event('preface:profiles-changed'))")

    const topbar = read('src/renderer/components/TopBar.tsx')
    expect(topbar).toContain("addEventListener('preface:profiles-changed'")
  })
})
