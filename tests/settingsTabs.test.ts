import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 设置页的标签结构，以及澄清面板的更正输入框。
 *
 * 用户要求：
 * - "找回之前的内容"要作为独立标签，放在"提示词与风格"和"关于"之间
 * - 澄清面板的"不对，我来更正"输入框要做成全宽
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

describe('设置页的标签', () => {
  const source = read('src/renderer/components/SettingsDialog.tsx')

  it('有六个标签', () => {
    // 通用、模型、语音、提示词与风格、找回之前的内容、关于
    const tabMatches = source.match(/<Tab value=/g) ?? []
    expect(tabMatches).toHaveLength(6)
  })

  it('"找回之前的内容"排在"提示词与风格"之后', () => {
    const promptsIndex = source.indexOf('<Tab value="prompts"')
    const historyIndex = source.indexOf('<Tab value="history"')
    expect(promptsIndex).toBeGreaterThan(-1)
    expect(historyIndex).toBeGreaterThan(promptsIndex)
  })

  it('"找回之前的内容"排在"关于"之前', () => {
    const historyIndex = source.indexOf('<Tab value="history"')
    const aboutIndex = source.indexOf('<Tab value="about"')
    expect(historyIndex).toBeLessThan(aboutIndex)
  })

  it('标签内容渲染了 HistoryPanel', () => {
    expect(source).toContain("tab === 'history' && <HistoryPanel")
  })
})

describe('历史面板不再放在通用标签里', () => {
  it('通用标签里没有 HistoryPanel', () => {
    const general = read('src/renderer/components/settings/GeneralTab.tsx')
    expect(general).not.toContain('HistoryPanel')
  })
})

describe('提示语指向正确的入口', () => {
  it('不再提到不存在的「更多」菜单', () => {
    const files = [
      'src/renderer/useDraft.ts',
      'src/renderer/components/ClearButton.tsx',
      'src/renderer/components/settings/HistoryPanel.tsx'
    ]

    for (const file of files) {
      const source = read(file)
      // 只看用户能看到的提示语，注释里的说明不算
      const userFacing = source
        .split('\n')
        .filter((line) => line.includes('text:') || line.includes('placeholder'))
        .join('\n')
      expect(userFacing).not.toContain('「更多」')
    }
  })

  it('指向「设置 → 找回之前的内容」', () => {
    expect(read('src/renderer/useDraft.ts')).toContain("'notice.previousAvailable'")
  })
})

describe('澄清面板的更正输入框', () => {
  const source = read('src/renderer/components/ClarifyPanel.tsx')

  it('是全宽的多行输入框', () => {
    expect(source).toContain("width: '100%'")
    expect(source).toContain('Textarea')
  })

  it('可以纵向拉伸，方便查看已输入的内容', () => {
    expect(source).toContain('resize="vertical"')
  })

  it('有最小高度', () => {
    expect(source).toContain('minHeight')
  })
})

describe('澄清面板的问题卡片不会被截断', () => {
  const source = read('src/renderer/components/ClarifyPanel.tsx')

  it('卡片高度由内容决定', () => {
    // 不能给卡片设固定高度
    expect(source).toContain('flexShrink: 0')
  })

  it('题目列表可以上下滚动', () => {
    expect(source).toContain('overflowY: \'auto\'')
  })

  it('每题最后两个固定选项存在', () => {
    expect(source).toContain("t('clarify.delegate')")
    expect(source).toContain("t('clarify.ownAnswer')")
  })
})
