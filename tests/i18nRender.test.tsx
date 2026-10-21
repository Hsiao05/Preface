// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BottomBar } from '../src/renderer/components/BottomBar'
import { CopyIssuesDialog } from '../src/renderer/components/CopyIssuesDialog'
import { EditorArea } from '../src/renderer/components/EditorArea'
import { PromptContextBar } from '../src/renderer/components/PromptContextBar'
import { PromptLibraryDialog } from '../src/renderer/components/PromptLibraryDialog'
import { useStore } from '../src/renderer/store'
import { createDraft, type Draft } from '../src/shared/types'
import { preCopyCheck } from '../src/shared/preCopyCheck'
import type { PromptLibraryItem, PromptSelection } from '../src/shared/promptLibrary'

/**
 * 英文界面的渲染验收。
 *
 * 用户自己写的标题、文件名和正文不翻译；除此之外，这些界面上不应该
 * 再出现中文。内置提示词正文所在的设置页不在本测试范围内。
 */

const CJK = /[㐀-鿿]/

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

function setStore(overrides: Partial<Draft> = {}): void {
  const draft = { ...createDraft('test-draft'), intentText: 'Hello', ...overrides }
  useStore.setState({
    draft,
    activeTab: 'source',
    uiLanguage: 'en',
    notice: null
  })
}

describe('英文底栏', () => {
  it('所有动作都是英文，没有中文残留', () => {
    setStore()
    const { container } = render(
      <BottomBar
        onTidy={() => {}}
        onImprove={() => {}}
        onOptimize={() => {}}
        onCopy={() => {}}
        onCancel={() => {}}
        onUndoText={() => {}}
        onOpenPromptLibrary={() => {}}
        canUndoText={false}
        undoTextLabel=""
        runningKind={null}
      />
    )

    expect(screen.getByRole('button', { name: 'Tidy up' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Improve writing' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Prompt library' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy all' })).toBeTruthy()
    expect(container.textContent ?? '').not.toMatch(CJK)
  })
})

describe('英文 Prompt 状态条', () => {
  it('界面文案是英文，用户标题原样显示', () => {
    setStore()
    const selection: PromptSelection = {
      id: 'p1',
      title: 'Meeting notes',
      content: 'Body',
      mode: 'reference'
    }
    const { container } = render(
      <PromptContextBar
        selection={selection}
        activePrompt={null}
        running={false}
        onOpenLibrary={() => {}}
        onRemove={() => {}}
      />
    )

    expect(container.textContent).toContain('Used when optimizing: ')
    expect(container.textContent).toContain('Meeting notes')
    expect(container.textContent ?? '').not.toMatch(CJK)
  })
})

describe('英文编辑区的翻译按钮', () => {
  it('显示 Translate to French', () => {
    setStore({ result: { text: 'Hello', editedByUser: false, stale: false } })
    useStore.setState({ activeTab: 'result' })
    const { container } = render(
      <EditorArea
        translation={{
          targetLabel: 'French',
          runningPane: null,
          undoPane: null,
          undoSeconds: 0,
          onTranslate: () => {},
          onUndo: () => {},
          onCancel: () => {}
        }}
      />
    )

    expect(screen.getByRole('button', { name: 'Translate to French' })).toBeTruthy()
    expect(container.textContent ?? '').not.toMatch(CJK)
  })
})

describe('英文复制问题弹窗', () => {
  it('问题标题和说明由当前语言生成', () => {
    setStore()
    const { issues } = preCopyCheck(
      {
        files: [],
        corpora: [
          {
            id: 'C1',
            title: 'Notes',
            titleSource: 'user',
            content: 'Text',
            chars: 4,
            createdAt: 0
          }
        ],
        body: '',
        target: 'local'
      },
      'en'
    )
    // 未被引用的资料会生成问题；这里渲染真实生成的问题文案
    expect(issues.length).toBeGreaterThan(0)

    render(
      <CopyIssuesDialog
        open
        issues={issues}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )

    // Dialog 渲染在 portal 里，检查整个 body 才能覆盖到它
    expect(screen.getByText('Review before copying')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(CJK)
  })
})

describe('英文 Prompt 库', () => {
  it('列表和操作都是英文，用户标题保持原样', async () => {
    setStore()
    const promptItems: PromptLibraryItem[] = [
      {
        id: 'p1',
        title: 'Meeting notes',
        content: 'Turn the transcript into decisions and action items.',
        titleSource: 'user',
        createdAt: 1,
        updatedAt: 1
      }
    ]
    ;(window as unknown as { preface: unknown }).preface = {
      onFocusInput: () => () => {},
      listPrompts: async () => ({ ok: true, items: promptItems }),
      savePrompt: async () => ({ ok: true, items: promptItems }),
      deletePrompt: async () => ({ ok: true, items: promptItems }),
      listStyles: async () => ({ items: [] }),
      runLlm: async () => ({ requestId: 'r1', done: Promise.resolve() }),
      cancelLlm: async () => true
    }

    render(
      <PromptLibraryDialog
        open
        onClose={() => {}}
        onAppend={() => {}}
        onUse={() => {}}
        busy={false}
      />
    )

    expect(await screen.findByText('Prompt library')).toBeTruthy()
    expect(await screen.findByText('Meeting notes')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(CJK)
  })
})
