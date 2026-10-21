import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Prompt 库界面与主界面的接线约束。
 *
 * 交互细节由 tests/promptContextBar.test.tsx、tests/promptLibraryDialog.test.tsx
 * 这类真实渲染测试覆盖；这里只锁住"入口位置、快捷键隔离、状态不回到底栏"
 * 这些容易在改动中丢失的结构。
 */

const root = join(__dirname, '..')
const read = (path: string): string => readFileSync(join(root, path), 'utf-8')

const bottomBar = read('src/renderer/components/BottomBar.tsx')
const app = read('src/renderer/App.tsx')
const dialog = read('src/renderer/components/PromptLibraryDialog.tsx')
const editorArea = read('src/renderer/components/EditorArea.tsx')
const contextBar = read('src/renderer/components/PromptContextBar.tsx')

describe('入口位置', () => {
  it('「我的Prompt库」在「优化提示词」左侧', () => {
    // 按图标用法定位两个按钮，避免匹配到 import 和 Tooltip 文案
    expect(bottomBar.indexOf('icon={<Library20Regular />}')).toBeLessThan(
      bottomBar.indexOf('icon={<Sparkle20Regular />}')
    )
  })

  it('运行中也能打开库，只读查看和设置下一次选择', () => {
    const start = bottomBar.indexOf('icon={<Library20Regular />}')
    const libraryButton = bottomBar.slice(start, bottomBar.indexOf("t('bottomBar.library')", start))
    expect(libraryButton).not.toContain('disabled={busy}')
  })

  it('窄窗口动作使用两列网格，不靠自然折行', () => {
    expect(bottomBar).toContain("gridTemplateColumns: '1fr 1fr'")
    expect(bottomBar).toContain('whiteSpace: \'nowrap\'')
  })
})

describe('Prompt 状态的位置', () => {
  it('状态不再出现在底栏', () => {
    expect(bottomBar).not.toContain('本轮 Prompt：')
    expect(bottomBar).not.toContain('promptBar')
  })

  it('状态由编辑区工具行承载', () => {
    expect(editorArea).toContain('promptContext')
    expect(editorArea).toContain('styles.promptSlot')
    expect(app).toContain('<PromptContextBar')
    expect(contextBar).toContain("t('promptContext.thisRun')")
  })

  it('完整模板说明只保留一处，不再和模式开关并排', () => {
    expect(bottomBar).not.toContain('本轮按模板格式输出')
    expect(contextBar).toContain("t('promptContext.helpTemplateMode')")
    expect(bottomBar).toContain('aria-describedby="mode-hint"')
  })
})

describe('快捷键隔离', () => {
  it('弹窗打开时暂停主窗口的优化/复制快捷键', () => {
    expect(app).toContain('runningKind || promptLibraryOpen ? null : handleOptimize')
    expect(app).toContain('runningKind || promptLibraryOpen ? null : () => void copy()')
  })

  it('Esc 先交给弹窗处理，不直接隐藏窗口', () => {
    expect(app).toContain('if (promptLibraryOpen) return')
  })
})

describe('追加与使用', () => {
  it('追加到原文用 appendIntentText（会切回 editing 并标记结果过期）', () => {
    expect(app).toContain('state.appendIntentText(item.content)')
  })

  it('设置本轮只写选择，不调用模型', () => {
    const handler = app.slice(
      app.indexOf('handleUsePrompt'),
      app.indexOf('// 弹窗打开时暂停主窗口')
    )
    expect(handler).toContain('setPromptSelection')
    expect(handler).not.toContain('runLlm')
    expect(handler).not.toContain('optimize(')
  })

  it('正在优化时可以看库，但不能追加原文', () => {
    expect(dialog).toContain('disabled={saving || !canEdit || !draft.content.trim()}')
  })
})
