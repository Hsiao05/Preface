// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { PromptLibraryDialog } from '../src/renderer/components/PromptLibraryDialog'
import type { PromptLibraryItem } from '../src/shared/promptLibrary'

/**
 * Prompt 库对话框的真实渲染测试。
 *
 * 重点验证重排后的信息层级没有破坏行为：
 * - 列表选中、当前项语义；
 * - 条目管理与使用动作分开；
 * - 运行中仍可打开、保存、设置下一次选择，但追加和 AI 标题禁用。
 *
 * 布局像素由隔离浏览器夹具验收，这里不假装能测出来。
 */

const items: PromptLibraryItem[] = [
  {
    id: 'p1',
    title: '会议纪要整理',
    content: '把会议记录整理成结论和待办。',
    titleSource: 'user',
    createdAt: 1,
    updatedAt: 1
  },
  {
    id: 'p2',
    title: '需求评审',
    content: '按评审清单逐项检查。',
    titleSource: 'user',
    createdAt: 2,
    updatedAt: 2
  }
]

function installPrefaceMock(result = { ok: true as const, items }): void {
  ;(window as unknown as { preface: unknown }).preface = {
    listPrompts: async () => result,
    savePrompt: async () => ({ ok: true, items }),
    deletePrompt: async () => ({ ok: true, items }),
    listStyles: async () => ({ items: [] }),
    runLlm: async () => ({ requestId: 'r1', done: Promise.resolve() }),
    cancelLlm: async () => true
  }
}

beforeEach(() => {
  installPrefaceMock()
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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderDialog(props: Partial<Parameters<typeof PromptLibraryDialog>[0]> = {}): {
  onAppend: ReturnType<typeof vi.fn>
  onUse: ReturnType<typeof vi.fn>
  onClose: ReturnType<typeof vi.fn>
} {
  const onAppend = vi.fn()
  const onUse = vi.fn()
  const onClose = vi.fn()

  render(
    <PromptLibraryDialog
      open
      onClose={onClose}
      onAppend={onAppend}
      onUse={onUse}
      busy={false}
      {...props}
    />
  )

  return { onAppend, onUse, onClose }
}

describe('列表', () => {
  it('显示条目，默认选中第一条并标出当前项', async () => {
    renderDialog()

    const first = await screen.findByText('会议纪要整理')
    expect(screen.getByText('需求评审')).toBeTruthy()

    // 默认选中发生在首次加载完成后的 effect 里
    await waitFor(() =>
      expect(first.closest('button')?.getAttribute('aria-current')).toBe('true')
    )
  })

  it('长标题保留完整文本作为提示，不截断数据', async () => {
    const long = '会'.repeat(100)
    installPrefaceMock({
      ok: true,
      items: [{ ...items[0], title: long }]
    })
    renderDialog()

    const title = await screen.findByText(long)
    expect(title.closest('button')?.getAttribute('title')).toBe(long)
  })
})

describe('动作分层', () => {
  it('页脚只保留关闭和两个使用动作，不再重复使用方式长文案', async () => {
    renderDialog()
    await screen.findByText('会议纪要整理')

    expect(screen.getByText('关闭')).toBeTruthy()
    expect(screen.getByText('追加到原文')).toBeTruthy()
    expect(screen.getByText('使用这个 Prompt')).toBeTruthy()
    expect(screen.queryByText(/用于本轮优化/)).toBeNull()
  })

  it('「使用这个 Prompt」把当前条目和使用方式交给主界面', async () => {
    const { onUse } = renderDialog()
    await screen.findByText('会议纪要整理')

    fireEvent.click(screen.getByText('完整模板套用'))
    fireEvent.click(screen.getByText('使用这个 Prompt'))

    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1))
    expect(onUse.mock.calls[0][0].id).toBe('p1')
    expect(onUse.mock.calls[0][1]).toBe('template')
  })

  it('追加到原文使用当前条目并关闭', async () => {
    const { onAppend, onClose } = renderDialog()
    await screen.findByText('会议纪要整理')
    // 等默认选中第一条、正文真正进入编辑区后再点
    await waitFor(() =>
      expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toContain('会议记录')
    )

    fireEvent.click(screen.getByText('追加到原文'))

    await waitFor(() => expect(onAppend).toHaveBeenCalledTimes(1))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('运行中的限制', () => {
  it('可以打开、查看和保存，但追加与 AI 标题禁用', async () => {
    renderDialog({ busy: true })
    await screen.findByText('会议纪要整理')
    // 等默认条目真正填进编辑区
    await waitFor(() =>
      expect((screen.getByLabelText('正文') as HTMLTextAreaElement).value).toContain('会议记录')
    )

    expect(
      (screen.getByText('追加到原文').closest('button') as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (screen.getByText('AI总结适用场景').closest('button') as HTMLButtonElement).disabled
    ).toBe(true)

    // 保存仍可用（内容非空）
    expect((screen.getByText('保存').closest('button') as HTMLButtonElement).disabled).toBe(false)
    // 「使用这个 Prompt」仍可用
    expect(
      (screen.getByText('使用这个 Prompt').closest('button') as HTMLButtonElement).disabled
    ).toBe(false)
  })
})

describe('空库与错误', () => {
  it('空库显示说明而不是空白列表', async () => {
    installPrefaceMock({ ok: true, items: [] })
    renderDialog()

    expect(await screen.findByText(/还没有保存的 Prompt/)).toBeTruthy()
  })

  it('读取失败时显示错误，不假报为空库', async () => {
    ;(window as unknown as { preface: unknown }).preface = {
      ...(window as unknown as { preface: Record<string, unknown> }).preface,
      listPrompts: async () => ({ ok: false, error: 'Prompt 库文件损坏', items: [] })
    }
    renderDialog()

    expect(await screen.findByText('Prompt 库文件损坏')).toBeTruthy()
  })
})

describe('列表与编辑区的可访问关联', () => {
  it('标题和正文都有明确标签', async () => {
    renderDialog()
    await screen.findByText('会议纪要整理')

    expect(screen.getByLabelText('标题')).toBeTruthy()
    expect(screen.getByLabelText('正文')).toBeTruthy()
    expect(screen.getByLabelText('使用方式')).toBeTruthy()
  })
})
