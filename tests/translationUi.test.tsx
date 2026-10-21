// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { EditorArea } from '../src/renderer/components/EditorArea'
import { BottomBar } from '../src/renderer/components/BottomBar'
import { useStore } from '../src/renderer/store'
import { createDraft } from '../src/shared/types'

/**
 * 翻译按钮与底栏动作的真实渲染测试。
 *
 * 像素布局由隔离浏览器夹具验收；这里锁住按钮的位置、状态和标签。
 */

type TranslationProps = NonNullable<
  Parameters<typeof EditorArea>[0]['translation']
>

function readSource(path: string): string {
  return readFileSync(join(__dirname, path), 'utf-8')
}

function setDraft(resultText: string | null, intentText = '原文'): void {
  const draft = createDraft('test-draft')
  draft.intentText = intentText
  draft.result =
    resultText === null
      ? null
      : { text: resultText, editedByUser: false, stale: false }
  useStore.setState({ draft, activeTab: 'result', uiLanguage: 'zh', notice: null })
}

function translation(
  overrides: Partial<TranslationProps> = {}
): TranslationProps {
  return {
    targetLabel: '法语',
    runningPane: null,
    undoPane: null,
    undoSeconds: 0,
    onTranslate: vi.fn(),
    onUndo: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false
    })
  })
  ;(window as unknown as { preface: unknown }).preface = {
    onFocusInput: () => () => {}
  }
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('结果页的翻译按钮', () => {
  it('显示「翻译成 XX」并报告 result 面板', () => {
    setDraft('Hello')
    const t = translation()
    render(<EditorArea translation={t} />)

    const button = screen.getByRole('button', { name: '翻译成法语' })
    expect(button).toBeTruthy()
    expect(button.getAttribute('title')).toBe('翻译成法语')

    fireEvent.click(button)
    expect(t.onTranslate).toHaveBeenCalledWith('result')
  })

  it('没有结果时不显示翻译按钮', () => {
    setDraft(null)
    render(<EditorArea translation={translation()} />)

    expect(screen.queryByRole('button', { name: '翻译成法语' })).toBeNull()
  })

  it('翻译进行中，原位变成「取消翻译」', () => {
    setDraft('Hello')
    const t = translation({ runningPane: 'result' })
    render(<EditorArea translation={t} />)

    const button = screen.getByRole('button', { name: '取消翻译' })
    expect(button.hasAttribute('disabled')).toBe(false)

    fireEvent.click(button)
    expect(t.onCancel).toHaveBeenCalled()
  })

  it('翻译完成后，原位变成带倒计时的撤销按钮', () => {
    setDraft('Bonjour')
    const t = translation({ undoPane: 'result', undoSeconds: 4 })
    render(<EditorArea translation={t} />)

    const button = screen.getByRole('button', { name: '撤销翻译（4）' })
    fireEvent.click(button)
    expect(t.onUndo).toHaveBeenCalled()
  })

  it('其他模型调用进行中时禁用翻译', () => {
    setDraft('Hello')
    render(<EditorArea translation={translation()} busy />)

    const button = screen.getByRole('button', { name: '翻译成法语' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('按钮贴左下角，有和编辑框一致的实心底色，并给长语言名留省略规则', () => {
    const source = readSource('../src/renderer/components/EditorArea.tsx')
    expect(source).toContain('translateSlot')
    expect(source).toContain("left: '10px'")
    expect(source).toContain("bottom: '8px'")
    expect(source).toContain('textOverflow')
    expect(source).toContain('maxWidth')
    // 底色不能透明，否则正文会从按钮底下透出来
    expect(source).toContain('backgroundColor: tokens.colorNeutralBackground3')
    expect(source).toContain('colorNeutralBackground3Hover')
    expect(source).toContain('colorNeutralBackground3Pressed')
  })
})

describe('底栏的优化表达', () => {
  const baseProps = {
    onTidy: vi.fn(),
    onImprove: vi.fn(),
    onOptimize: vi.fn(),
    onCopy: vi.fn(),
    onCancel: vi.fn(),
    onUndoText: vi.fn(),
    onOpenPromptLibrary: vi.fn(),
    undoTextLabel: '撤销整理',
    canUndoText: false,
    runningKind: null as null
  }

  beforeEach(() => {
    const draft = createDraft('test-draft')
    draft.intentText = '原文'
    useStore.setState({ draft, uiLanguage: 'zh' })
  })

  it('「优化表达」在「整理碎碎念」右侧', () => {
    render(<BottomBar {...baseProps} />)

    const tidy = screen.getByRole('button', { name: '整理碎碎念' })
    const improve = screen.getByRole('button', { name: '优化表达' })
    expect(
      tidy.compareDocumentPosition(improve) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('优化表达运行中，左侧只显示取消', () => {
    render(<BottomBar {...baseProps} runningKind="expression" />)

    expect(screen.queryByRole('button', { name: '整理碎碎念' })).toBeNull()
    expect(screen.queryByRole('button', { name: '优化表达' })).toBeNull()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
  })

  it('可以撤销时显示传入的撤销标签', () => {
    render(
      <BottomBar {...baseProps} canUndoText undoTextLabel="撤销优化表达" />
    )

    expect(screen.getByRole('button', { name: '撤销优化表达' })).toBeTruthy()
  })

  it('翻译进行中时，整理/优化/复制都禁用，库仍可打开', () => {
    render(<BottomBar {...baseProps} runningKind="translate" />)

    expect(
      screen.getByRole('button', { name: '整理碎碎念' }).hasAttribute('disabled')
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: '优化表达' }).hasAttribute('disabled')
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: '一键复制' }).hasAttribute('disabled')
    ).toBe(true)
    expect(
      screen.getByRole('button', { name: '我的Prompt库' }).hasAttribute('disabled')
    ).toBe(false)
  })

  it('窄窗口两列网格，复制独占整行', () => {
    const source = readSource('../src/renderer/components/BottomBar.tsx')
    expect(source).toContain("@media (max-width: 839px)")
    expect(source).toContain("gridTemplateColumns: '1fr 1fr'")
    expect(source).toContain("gridColumn: '1 / -1'")
  })
})
