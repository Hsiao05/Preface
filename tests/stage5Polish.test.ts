import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createDraft } from '../src/shared/types'

/**
 * 第五阶段的收尾改动：
 * 1. 提示词编辑框占满高度、背景跟随主题
 * 2. 左侧列表选中态在深色下不刺眼
 * 3. 全局缩放
 * 4. 试用区
 * 5. 改坏了的保护（连续两次兜底时提示）
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

describe('提示词编辑框', () => {
  const source = read('src/renderer/components/settings/PromptsTab.tsx')

  it('用容器 + 绝对定位撑满（不用 height: 100%）', () => {
    expect(source).toContain('textareaBox')
    expect(source).toContain("position: 'absolute'")
    expect(source).toContain('inset: 0')
  })

  it('用原生 textarea，背景透明让容器底色透出来', () => {
    expect(source).toContain('<textarea')
    expect(source).toContain("backgroundColor: 'transparent'")
  })

  it('容器用 Background3（深色下最深的那一档）', () => {
    /*
     * 【为什么是 Background3】
     * Fluent 的深色主题里数字越小越暗（和浅色主题相反）：
     *   Background1 = #292929（偏灰，就是用户说"灰灰的"那个）
     *   Background3 = #141414（更深，主窗口编辑区用的就是这个）
     * 用 Background1 会让设置页比主窗口灰一档。
     */
    const boxStyle = source.slice(
      source.indexOf('textareaBox: {'),
      source.indexOf('textarea: {')
    )
    expect(boxStyle).toContain('tokens.colorNeutralBackground3')
    expect(boxStyle).not.toContain('colorNeutralBackground1')
  })

  it('整个文件里不出现 Fluent 的 Textarea（它自带灰色背景）', () => {
    expect(source).not.toContain('<Textarea')
  })

  it('风格样本框也用原生 textarea 和同一套背景', () => {
    const sampleStyle = source.slice(
      source.indexOf('sampleInput: {'),
      source.indexOf('preview: {')
    )
    expect(sampleStyle).toContain('colorNeutralBackground3')
  })

  it('锁定项的只读区也用同一套外观', () => {
    const readonlyStyle = source.slice(
      source.indexOf('readonly: {'),
      source.indexOf('tokenLine: {')
    )
    expect(readonlyStyle).toContain("position: 'absolute'")
    expect(readonlyStyle).toContain("backgroundColor: 'transparent'")
  })
})

describe('左侧列表的选中态', () => {
  const source = read('src/renderer/components/settings/PromptsTab.tsx')

  it('不用 colorBrandBackground2（深色下太扎眼）', () => {
    const activeStyle = source.slice(
      source.indexOf('itemActive: {'),
      source.indexOf('editedMark: {')
    )
    expect(activeStyle).not.toContain('colorBrandBackground2')
  })

  it('用中性色 + 左侧竖条', () => {
    const activeStyle = source.slice(
      source.indexOf('itemActive: {'),
      source.indexOf('editedMark: {')
    )
    expect(activeStyle).toContain('colorNeutralBackground3')
    expect(activeStyle).toContain('inset 3px 0 0 0')
  })
})

describe('全局缩放', () => {
  it('设置项有 zoom，默认 1，范围 0.7 到 1.5', () => {
    const source = read('src/main/settings.ts')
    expect(source).toContain('zoom: z.number().min(0.7).max(1.5).default(1)')
  })

  it('用 webContents.setZoomFactor 实现', () => {
    const source = read('src/main/window.ts')
    expect(source).toContain('setZoomFactor')
  })

  it('启动时应用', () => {
    expect(read('src/main/index.ts')).toContain('applyZoom(settings.zoom)')
  })

  it('设置变更时立刻应用', () => {
    expect(read('src/main/ipc.ts')).toContain('applyZoom(next.zoom)')
  })

  it('界面有加减按钮和恢复默认', () => {
    const source = read('src/renderer/components/settings/GeneralTab.tsx')
    expect(source).toContain('界面缩放')
    expect(source).toContain('ZoomIn20Regular')
    expect(source).toContain('ZoomOut20Regular')
    expect(source).toContain('恢复默认')
  })

  it('缩放值被限制在范围内', () => {
    const source = read('src/renderer/components/settings/GeneralTab.tsx')
    expect(source).toContain('Math.max(0.7, Math.min(1.5, next))')
  })

  it('避免浮点误差（保留一位小数）', () => {
    const source = read('src/renderer/components/settings/GeneralTab.tsx')
    expect(source).toContain('Math.round(next * 10) / 10')
  })
})

describe('试用区', () => {
  const source = read('src/renderer/components/settings/PromptsTab.tsx')

  it('有输入框和"试一下"按钮', () => {
    expect(source).toContain('试用')
    expect(source).toContain('试一下')
    expect(source).toContain('tryRun')
  })

  it('用当前编辑中（未保存）的提示词', () => {
    // 把当前选中项替换成 draftText
    expect(source).toContain('i.id === selectedId ? { ...i, text: draftText, samples: draftSamples } : i')
  })

  it('不碰主窗口的草稿', () => {
    // 只调用 run 发请求，不调用 setDraft
    const trySection = source.slice(source.indexOf('const tryRun'), source.indexOf('if (!items)'))
    expect(trySection).not.toContain('setDraft')
    expect(trySection).not.toContain('setIntentText')
  })

  it('显示本次用量', () => {
    expect(source).toContain('tryUsage')
    expect(source).toContain('formatTokenCount')
  })
})

describe('改坏了的保护', () => {
  it('草稿里有兜底计数', () => {
    const draft = createDraft('d1')
    expect(draft.fallbackStreak).toBe(0)
  })

  it('连续两次兜底时才提示', () => {
    const source = read('src/renderer/useOptimize.ts')
    // 第一次不提示
    expect(source).toContain('if (streak < 2) return')
  })

  it('只在用户改过提示词时提示', () => {
    const source = read('src/renderer/useOptimize.ts')
    expect(source).toContain('editedPrompt')
    expect(source).toContain("i.kind === 'block' || i.kind === 'template'")
  })

  it('提示语指向设置页', () => {
    const source = read('src/renderer/useOptimize.ts')
    expect(source).toContain('设置 → 提示词与风格')
  })

  it('成功拿到结果时计数清零', () => {
    const source = read('src/renderer/useOptimize.ts')
    expect(source).toContain('clearFallback')
  })
})

describe('快捷键（Ctrl+Alt+P 被 Magpie 占用，改用 Ctrl+Alt+X）', () => {
  it('默认值是 Ctrl+Alt+X（X 取自「序」的声母）', () => {
    const source = read('src/main/settings.ts')
    expect(source).toContain("shortcut: z.string().default('CommandOrControl+Alt+X')")
  })

  it('老设置里的旧默认值会被迁移到新默认值', () => {
    const source = read('src/main/settings.ts')
    expect(source).toContain('SHORTCUT_MIGRATIONS')
    expect(source).toContain("'CommandOrControl+Alt+K'")
  })

  it('有备选快捷键，被占用时自动回退', () => {
    const source = read('src/main/shortcut.ts')
    expect(source).toContain('registerShortcutWithFallback')
    expect(source).toContain('CommandOrControl+Alt+U')
  })
})
