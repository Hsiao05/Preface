// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PromptContextBar } from '../src/renderer/components/PromptContextBar'
import type { PromptSelection } from '../src/shared/promptLibrary'

/**
 * 编辑区 Prompt 状态的真实渲染测试。
 *
 * 这里验证的是「状态展示 + 更换/移除行为」，
 * 像素级布局由隔离浏览器夹具验收，jsdom 不能替代。
 */

const reference: PromptSelection = {
  id: 'p1',
  title: '会议纪要整理',
  content: '正文',
  mode: 'reference'
}

const template: PromptSelection = {
  ...reference,
  mode: 'template'
}

function renderBar(overrides: Partial<Parameters<typeof PromptContextBar>[0]> = {}): {
  onOpenLibrary: ReturnType<typeof vi.fn>
  onRemove: ReturnType<typeof vi.fn>
} {
  const onOpenLibrary = vi.fn()
  const onRemove = vi.fn()

  render(
    <PromptContextBar
      selection={reference}
      activePrompt={null}
      running={false}
      onOpenLibrary={onOpenLibrary}
      onRemove={onRemove}
      {...overrides}
    />
  )

  return { onOpenLibrary, onRemove }
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
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('状态展示', () => {
  it('没有选择也没有正在使用的快照时不显示', () => {
    const { container } = render(
      <PromptContextBar
        selection={null}
        activePrompt={null}
        running={false}
        onOpenLibrary={() => {}}
        onRemove={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('空闲时明确是「优化时使用」，不让人以为会跳过这一次', () => {
    renderBar()
    expect(screen.getByText('优化时使用：')).toBeTruthy()
    expect(screen.queryByText('下次优化：')).toBeNull()
    expect(screen.getByText('会议纪要整理')).toBeTruthy()
    expect(screen.getByText('参考结构和表达')).toBeTruthy()
  })

  it('这一轮已经开始时，改动才标成「下次优化」', () => {
    renderBar({ running: true })
    expect(screen.getByText('下次优化：')).toBeTruthy()
    expect(screen.queryByText('优化时使用：')).toBeNull()
  })

  it('完整模板套用时显示对应方式', () => {
    renderBar({ selection: template })
    expect(screen.getByText('完整模板套用')).toBeTruthy()
  })

  it('标题很长时仍然完整保留在可访问名称里，只做视觉省略', () => {
    const long = '很'.repeat(100)
    renderBar({ selection: { ...reference, title: long } })
    expect(screen.getByText(long)).toBeTruthy()
  })

  it('运行中移除了选择，显示「不使用 Prompt」并保留更换入口', () => {
    renderBar({ selection: null, activePrompt: template, running: true })
    expect(screen.getByText('不使用 Prompt')).toBeTruthy()
    expect(screen.getByText('更换')).toBeTruthy()
    expect(screen.queryByLabelText('移除这份 Prompt')).toBeNull()
  })

  it('请求结束后没有选择时整条隐藏，不长期挂着旧快照', () => {
    const { container } = render(
      <PromptContextBar
        selection={null}
        activePrompt={template}
        running={false}
        onOpenLibrary={() => {}}
        onRemove={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })
})

describe('操作', () => {
  it('「更换」只打开库，不直接改变选择', () => {
    const { onOpenLibrary, onRemove } = renderBar()
    fireEvent.click(screen.getByText('更换'))
    expect(onOpenLibrary).toHaveBeenCalledTimes(1)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('移除只清除这份 Prompt', () => {
    const { onRemove, onOpenLibrary } = renderBar()
    fireEvent.click(screen.getByLabelText('移除这份 Prompt'))
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onOpenLibrary).not.toHaveBeenCalled()
  })

  it('移除后状态条还在时，焦点落到仍然存在的「更换」', async () => {
    renderBar({ selection: reference, activePrompt: template, running: true })
    fireEvent.click(screen.getByLabelText('移除这份 Prompt'))

    // 父组件没有真的改状态，这里只验证焦点转移的时机不抛错、按钮仍存在
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(screen.getByText('更换')).toBeTruthy()
  })
})

describe('说明文案', () => {
  it('完整模板说明集中在帮助里，不再单独占一行', () => {
    renderBar({ selection: template })
    expect(screen.queryByText('本轮按模板格式输出')).toBeNull()
    expect(screen.getByLabelText('查看 Prompt 使用说明')).toBeTruthy()
  })
})
