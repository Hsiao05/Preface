// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { CorpusDialog } from '../src/renderer/components/CorpusDialog'
import type { LlmStreamEvent } from '../src/preload/index'

/**
 * 语料编辑窗口的真实交互测试。
 *
 * 【为什么不用源码字符串匹配】
 * 用户报的是"点过 AI 标题后改不了标题"。这类问题只有真的渲染出输入框、
 * 真的派发输入事件、真的让 AI 请求按指定顺序返回，才能验证清楚。
 *
 * 这里用一个可控的假模型：每次调用把 onEvent 存起来，由测试决定什么时候、
 * 按什么顺序返回结果。
 */

interface PendingCall {
  kind: string
  onEvent: (event: LlmStreamEvent) => void
  resolve: () => void
}

let calls: PendingCall[] = []

function installPrefaceMock(): void {
  calls = []

  ;(window as unknown as { preface: unknown }).preface = {
    listStyles: async () => ({ items: [] }),
    runLlm: async (
      kind: string,
      _messages: unknown,
      _sourceText: unknown,
      onEvent: (event: LlmStreamEvent) => void
    ) => {
      let resolve: () => void = () => {}
      const done = new Promise<void>((r) => {
        resolve = r
      })
      calls.push({ kind, onEvent, resolve })
      return { requestId: `req_${calls.length}`, done }
    },
    cancelLlm: async () => true
  }
}

/** 让第 index 个调用返回标题 */
async function replyWith(index: number, text: string): Promise<void> {
  const call = calls[index]
  call.onEvent({ type: 'done', text })
  call.resolve()
  // 等 React 把状态刷完
  await waitFor(() => expect(calls.length).toBeGreaterThan(index))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function titleInput(): HTMLInputElement {
  return screen.getByPlaceholderText('例如：客户口头反馈整理') as HTMLInputElement
}

beforeEach(() => {
  installPrefaceMock()
  // Fluent 的一些组件会用到 matchMedia
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

describe('语料编辑窗口：标题始终可以手动修改', () => {
  it('打开时标题可编辑，没有只读或禁用', () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '原标题', titleSource: 'user', content: '正文' }}
      />
    )

    const input = titleInput()
    expect(input.disabled).toBe(false)
    expect(input.readOnly).toBe(false)
  })

  it('AI 生成完成后，用户还能继续改标题', async () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '', titleSource: 'none', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))
    await replyWith(0, '客户口头反馈整理')

    await waitFor(() => expect(titleInput().value).toBe('客户口头反馈整理'))

    // 生成结束后再手改
    fireEvent.change(titleInput(), { target: { value: '我自己改的标题' } })
    expect(titleInput().value).toBe('我自己改的标题')
    expect(titleInput().disabled).toBe(false)
  })

  it('生成期间手改标题：迟到的 AI 结果不能覆盖', async () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '', titleSource: 'none', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))

    // 请求还没回来，用户自己写了一个
    fireEvent.change(titleInput(), { target: { value: '手写标题' } })
    expect(titleInput().value).toBe('手写标题')

    // AI 现在才回来
    await replyWith(0, 'AI 标题')

    expect(titleInput().value).toBe('手写标题')
  })

  it('用户再次点 AI 标题：新请求的结果可以正常回填', async () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '', titleSource: 'none', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))
    fireEvent.change(titleInput(), { target: { value: '手写' } })
    await replyWith(0, '旧结果')
    expect(titleInput().value).toBe('手写')

    // 再点一次
    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(2))
    await replyWith(1, '新结果')

    await waitFor(() => expect(titleInput().value).toBe('新结果'))
  })

  it('两个请求逆序返回：先发的不会盖掉后发的', async () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '', titleSource: 'none', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))

    // 第二个请求（正常按钮此时是 disabled，这里模拟"新请求先发出"）
    fireEvent.change(screen.getByPlaceholderText('把大段文字粘贴到这里'), {
      target: { value: '改过的资料' }
    })
    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(2))

    await replyWith(1, '第二个')
    await waitFor(() => expect(titleInput().value).toBe('第二个'))

    // 第一个迟到
    await replyWith(0, '第一个')
    expect(titleInput().value).toBe('第二个')
  })

  it('生成期间改正文：旧结果作废', async () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '', titleSource: 'none', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))

    fireEvent.change(screen.getByPlaceholderText('把大段文字粘贴到这里'), {
      target: { value: '完全不同的资料' }
    })
    await replyWith(0, '旧资料的标题')

    expect(titleInput().value).toBe('')
  })

  it('点「取消生成」之后，迟到的结果不回填', async () => {
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={() => {}}
        editing={{ id: 'C1', title: '已有标题', titleSource: 'user', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))
    fireEvent.click(screen.getByText('取消生成'))

    await replyWith(0, '迟到的标题')
    expect(titleInput().value).toBe('已有标题')
  })
})

describe('保存时传递真实标题来源', () => {
  it('AI 回填后保存，来源是 ai', async () => {
    const onConfirm = vi.fn()
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        editing={{ id: 'C1', title: '', titleSource: 'none', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('AI总结标题'))
    await waitFor(() => expect(calls).toHaveLength(1))
    await replyWith(0, 'AI 标题')
    await waitFor(() => expect(titleInput().value).toBe('AI 标题'))

    fireEvent.click(screen.getByText('保存'))

    expect(onConfirm).toHaveBeenCalledWith('AI 标题', '一段资料', 'ai', 'C1')
  })

  it('手改标题后保存，来源是 user', () => {
    const onConfirm = vi.fn()
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        editing={{ id: 'C1', title: 'AI 标题', titleSource: 'ai', content: '一段资料' }}
      />
    )

    fireEvent.change(titleInput(), { target: { value: '手写标题' } })
    fireEvent.click(screen.getByText('保存'))

    expect(onConfirm).toHaveBeenCalledWith('手写标题', '一段资料', 'user', 'C1')
  })

  it('没改标题就保存，保留原来源（不会被误标成 user）', () => {
    const onConfirm = vi.fn()
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        editing={{ id: 'C1', title: 'AI 标题', titleSource: 'ai', content: '一段资料' }}
      />
    )

    fireEvent.click(screen.getByText('保存'))

    expect(onConfirm).toHaveBeenCalledWith('AI 标题', '一段资料', 'ai', 'C1')
  })

  it('清空标题后保存，来源是 none', () => {
    const onConfirm = vi.fn()
    render(
      <CorpusDialog
        open
        onClose={() => {}}
        onConfirm={onConfirm}
        editing={{ id: 'C1', title: 'AI 标题', titleSource: 'ai', content: '一段资料' }}
      />
    )

    fireEvent.change(titleInput(), { target: { value: '' } })
    fireEvent.click(screen.getByText('保存'))

    expect(onConfirm).toHaveBeenCalledWith('', '一段资料', 'none', 'C1')
  })
})
