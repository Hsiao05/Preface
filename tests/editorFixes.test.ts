import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 三个修复：
 * 1. 深色模式下原文的光标看不见
 * 2. 优化结果的可编辑区域没有占满整个窗口
 * 3. 点"优化提示词"后流式内容跑到原文页，看起来像破坏了原文
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

describe('光标：必须用 CodeMirror 的主题 API', () => {
  const editor = read('src/renderer/components/IntentEditor.tsx')

  it('定义了编辑器主题函数', () => {
    expect(editor).toContain('function editorTheme')
    expect(editor).toContain('EditorView.theme')
  })

  it('深色下光标是白色', () => {
    expect(editor).toContain("borderLeftColor: isDark ? '#ffffff' : '#242424'")
  })

  it('声明了 dark facet，CodeMirror 内置的深色样式才会生效', () => {
    expect(editor).toContain('EditorView.darkTheme.of(isDark)')
  })

  it('主题放在 Compartment 里，切换深浅色不用重建编辑器', () => {
    expect(editor).toContain('Compartment')
    expect(editor).toContain('themeCompartment')
    expect(editor).toContain('reconfigure(editorTheme(isDark))')
  })

  it('CSS 文件里不再重复定义光标（那些规则会被 CodeMirror 覆盖）', () => {
    const css = read('src/renderer/index.css')
    expect(css).not.toContain('.cm-cursor')
    expect(css).not.toContain('.cm-selectionBackground')
  })

  it('CSS 里留了说明，讲清为什么不在这里写', () => {
    const css = read('src/renderer/index.css')
    expect(css).toContain('CodeMirror 会把自己的样式注入到')
  })
})

describe('结果区占满整个窗口', () => {
  const area = read('src/renderer/components/EditorArea.tsx')

  it('用绝对定位撑满父容器（百分比高度在 flex 里无效）', () => {
    // 结果区容器是 resultBox，内部内容用绝对定位撑满
    expect(area).toContain('resultBox')
    expect(area).toContain("position: 'absolute'")
    expect(area).toContain('inset: 0')
  })

  it('外层容器有相对定位', () => {
    expect(area).toContain("position: 'relative'")
  })

  it('注释说明了为什么不用 height: 100%', () => {
    // 说明在 resultBox / resultContent 的注释里
    expect(area).toContain('绝对定位')
  })

  it('输入框可以纵向滚动，长内容不会溢出', () => {
    expect(area).toContain("resize: 'none'")
  })
})

describe('优化时立刻跳到结果页', () => {
  const optimize = read('src/renderer/useOptimize.ts')

  it('开始优化时先切标签页，再发请求', () => {
    // 取 runOptimize 函数体
    const start = optimize.indexOf('const runOptimize = useCallback')
    expect(start).toBeGreaterThan(-1)

    const body = optimize.slice(start, optimize.indexOf('}, [callModel, handleReply])', start))

    const tabIndex = body.indexOf("setActiveTab('result')")
    const callIndex = body.indexOf('await callModel')

    expect(tabIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeGreaterThan(-1)
    // 切标签必须发生在发请求之前
    expect(tabIndex).toBeLessThan(callIndex)
  })

  it('续写澄清结果时也跳转', () => {
    // 三处调用点都要有 setActiveTab('result')
    const count = (optimize.match(/setActiveTab\('result'\)/g) ?? []).length
    expect(count).toBeGreaterThanOrEqual(3)
  })

  it('切换模式时也跳转', () => {
    const switchSection = optimize.slice(optimize.indexOf('runSwitchMode'))
    expect(switchSection).toContain("setActiveTab('result')")
  })
})

describe('流式内容只显示在结果页', () => {
  const area = read('src/renderer/components/EditorArea.tsx')

  it('原文页只渲染编辑器，不再显示流式内容', () => {
    // 原文分支里是编辑器 + 麦克风按钮，但没有流式内容
    const sourceBranch = area.slice(
      area.indexOf("activeTab === 'source' ?"),
      area.indexOf('<MicButton')
    )
    expect(sourceBranch).toContain('IntentEditor')
    expect(sourceBranch).not.toContain('streamText')
  })

  it('优化中但还没内容时显示"正在分析…"', () => {
    expect(area).toContain("t('editor.analyzing')")
  })

  it('优化中时"优化结果"标签可点', () => {
    expect(area).toContain('optimizing')
    expect(area).toContain('resultTabEnabled')
  })

  it('App 把优化状态传给了编辑区', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('optimizing={')
    expect(app).toContain("optimize.state.phase === 'analyzing'")
  })
})


describe('流式和可编辑共用同一个容器（切换时不跳动）', () => {
  const area = read('src/renderer/components/EditorArea.tsx')

  it('只有一个结果区容器样式', () => {
    // 原来有两套（resultReadonly 和 resultInputWrap），合并成一个 resultBox
    expect(area).toContain('resultBox')
    expect(area).not.toContain('resultReadonly')
    expect(area).not.toContain('resultInputWrap')
  })

  it('流式和可编辑两种状态都渲染在同一个容器里', () => {
    const boxIndex = area.indexOf('<div className={styles.resultBox}>')
    expect(boxIndex).toBeGreaterThan(-1)

    // 从容器开头到组件返回结束，应该同时包含流式分支和可编辑分支
    const inner = area.slice(boxIndex)

    // 流式分支：resultContent 直接包着 streamText
    expect(inner).toContain('<div className={styles.resultContent}>{streamText}</div>')
    // 可编辑分支：原生 textarea，样式是 resultEditable
    expect(inner).toContain('<textarea')
    expect(inner).toContain('className={styles.resultEditable}')
  })

  it('两种状态用同一套几何属性（定位、内边距、排版）', () => {
    // 两套样式必须都含这些，否则切换时会跳动
    const contentStyle = area.slice(
      area.indexOf('resultContent: {'),
      area.indexOf('resultEditable: {')
    )
    const editableStyle = area.slice(
      area.indexOf('resultEditable: {'),
      area.indexOf('editedMark: {')
    )

    for (const prop of ["position: 'absolute'", 'inset: 0', "padding: '10px 12px 44px'", 'lineHeight:'] ) {
      expect(contentStyle, `resultContent 缺少 ${prop}`).toContain(prop)
      expect(editableStyle, `resultEditable 缺少 ${prop}`).toContain(prop)
    }
  })

  it('可编辑状态用原生 textarea，避开 Fluent 自带的背景色', () => {
    // Fluent 的 Textarea 渲染成 span 包 textarea，自带背景色会和容器打架
    expect(area).toContain('原生 textarea')
    expect(area).toContain("backgroundColor: 'transparent'")
  })

  it('容器用绝对定位撑满（百分比高度在 flex 里无效）', () => {
    const contentStyle = area.slice(
      area.indexOf('resultContent: {'),
      area.indexOf('resultEditable: {')
    )
    expect(contentStyle).toContain("position: 'absolute'")
    expect(contentStyle).toContain('inset: 0')
  })

  it('两种状态的背景色来自同一个容器，不会一个深一个灰', () => {
    const boxStyle = area.slice(area.indexOf('resultBox: {'), area.indexOf('resultContent: {'))
    expect(boxStyle).toContain('tokens.colorNeutralBackground3')

    // textarea 本身要透明，否则会盖住容器底色
    expect(area).toContain("backgroundColor: 'transparent'")
  })
})


describe('状态条常驻占位（"跳一下"的真正原因）', () => {
  const area = read('src/renderer/components/EditorArea.tsx')

  it('状态条不再按内容显示/隐藏', () => {
    // 原来写的是 {(statusText || onSwitchMode) && (...)}，
    // 优化完成后才出现，占掉一行高度把结果框挤矮
    expect(area).not.toContain('{(statusText || onSwitchMode) &&')
  })

  it('状态条始终渲染', () => {
    expect(area).toContain('<div className={styles.statusBar}>')
  })

  it('状态条高度固定，内容变化不影响布局', () => {
    const style = area.slice(area.indexOf('statusBar: {'), area.indexOf('staleBar: {'))
    // 用 minHeight 占位：平时就是这一行高，文字换行时还能撑开不被裁掉
    expect(style).toContain("minHeight: '32px'")
    expect(style).toContain('boxSizing')
    // 不能被内容压缩
    expect(style).toContain('flexShrink: 0')
  })

  it('切换模式按钮仍然只在有结果时显示', () => {
    expect(area).toContain('onSwitchMode && hasResult')
  })
})
