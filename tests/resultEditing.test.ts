import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createDraft } from '../src/shared/types'
import { assemblePrompt } from '../src/shared/assemble'

/**
 * 优化结果的编辑。
 *
 * 用户要求：优化完之后能直接改结果，改完一键复制就能丢给 Agent。
 * 同时，编辑过的结果被覆盖前要先确认（文档第六节的要求）。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

describe('结果可以编辑', () => {
  it('结果区用的是可输入的控件', () => {
    const source = read('src/renderer/components/EditorArea.tsx')
    expect(source).toContain('Textarea')
    expect(source).toContain('setResultText')
  })

  it('编辑后标记 editedByUser', () => {
    const source = read('src/renderer/store.ts')
    expect(source).toContain('editedByUser: true')
  })

  it('界面上提示"你编辑过"', () => {
    const source = read('src/renderer/components/EditorArea.tsx')
    expect(source).toContain("t('editor.editedByUser')")
  })
})

describe('编辑过的结果被覆盖前要确认', () => {
  it('optimize 会经过覆盖确认', () => {
    const source = read('src/renderer/useOptimize.ts')
    expect(source).toContain('guardOverwrite')
    // 重新优化要走确认
    expect(source).toContain('guardOverwrite(() => {')
  })

  it('切换模式也要确认', () => {
    const source = read('src/renderer/useOptimize.ts')
    const switchSection = source.slice(source.indexOf('runSwitchMode'))
    expect(switchSection).toContain('guardOverwrite')
  })

  it('没编辑过时不弹确认', () => {
    const source = read('src/renderer/useOptimize.ts')
    // 只有 editedByUser 为 true 才拦
    expect(source).toContain('if (store.draft.result?.editedByUser)')
  })

  it('App 里有确认对话框', () => {
    const source = read('src/renderer/App.tsx')
    expect(source).toContain("t('dialog.overwrite.title')")
    expect(source).toContain('pendingConfirm')
  })
})

describe('编辑后的结果会被复制', () => {
  it('复制读的是 result.text（所以用户的修改会自动带上）', () => {
    const source = read('src/renderer/useCopy.ts')
    expect(source).toContain('draft.result?.text')
  })

  it('组装时用的是传入的正文', () => {
    // 用户改过的结果传给 assemblePrompt 后，必须原样出现在最终文字里
    const edited = '这是我手动改过的结果，里面还有 @F1。'
    const result = assemblePrompt({
      files: [
        {
          id: 'F1',
          name: 'a.docx',
          path: 'C:\\a.docx',
          ext: 'docx',
          size: 1,
          mtime: 1,
          note: '',
          permission: 'editable'
        }
      ],
      corpora: [],
      body: edited,
      target: 'local'
    })

    expect(result.text).toContain(edited)
  })
})

describe('原文改动后结果标记为过期', () => {
  /** 与 store.ts 的 setIntentText 相同逻辑 */
  function updateIntent(
    draft: ReturnType<typeof createDraft>,
    intentText: string
  ): ReturnType<typeof createDraft> {
    const next = { ...draft, intentText, updatedAt: Date.now() }
    if (next.result && !next.result.stale && next.result.text) {
      next.result = { ...next.result, stale: true }
    }
    return next
  }

  it('有结果时改原文，结果变成过期', () => {
    const draft = createDraft('d1')
    draft.result = { text: '结果', editedByUser: false, stale: false }
    expect(updateIntent(draft, '新原文').result?.stale).toBe(true)
  })

  it('没有结果时不报错', () => {
    const draft = createDraft('d1')
    expect(updateIntent(draft, '新原文').result).toBeNull()
  })

  it('结果是空的时不标记', () => {
    const draft = createDraft('d1')
    draft.result = { text: '', editedByUser: false, stale: false }
    expect(updateIntent(draft, '新原文').result?.stale).toBe(false)
  })

  it('已经标记过的保持原样', () => {
    const draft = createDraft('d1')
    draft.result = { text: '结果', editedByUser: false, stale: true }
    expect(updateIntent(draft, '新原文').result?.stale).toBe(true)
  })
})

describe('深浅色模式用下拉框', () => {
  it('设置里用的是 Dropdown 而不是滑块', () => {
    const source = read('src/renderer/components/settings/GeneralTab.tsx')
    expect(source).toContain("t('settings.general.theme')")
    expect(source).toContain('Dropdown')
    // 不该再有 ToggleButton 做的三段开关
    expect(source).not.toContain('ToggleButton')
  })

  it('三个选项都在', () => {
    const source = read('src/renderer/components/settings/GeneralTab.tsx')
    expect(source).toContain("t('settings.general.themeSystem')")
    expect(source).toContain("t('settings.general.themeLight')")
    expect(source).toContain("t('settings.general.themeDark')")
  })
})

describe('深色模式下的光标和编辑区颜色', () => {
  /*
   * 【为什么改到编辑器主题里】
   * 原来这些颜色写在 index.css，但 CodeMirror 会把自己的样式注入到 <head>，
   * 优先级更高，我们的规则被盖掉了 —— 深色下光标看不见就是这个原因。
   * 现在改由 IntentEditor 的 editorTheme() 定义。
   */
  const editor = read('src/renderer/components/IntentEditor.tsx')

  it('光标在深色下改成白色（CodeMirror 默认是硬编码黑色）', () => {
    expect(editor).toContain("borderLeftColor: isDark ? '#ffffff' : '#242424'")
  })

  it('浅色下光标是深色，保证可见', () => {
    expect(editor).toContain("'#242424'")
  })

  it('选中文字的背景深浅各一套', () => {
    expect(editor).toContain("backgroundColor: isDark ? '#264f78' : '#b4d7f5'")
  })

  it('原文输入区和结果区用同一个底色', () => {
    const area = read('src/renderer/components/EditorArea.tsx')
    // 两边都用 Background3，切换标签时不会忽明忽暗
    expect(editor).toContain('tokens.colorNeutralBackground3')
    expect(area).toContain('tokens.colorNeutralBackground3')
  })
})
