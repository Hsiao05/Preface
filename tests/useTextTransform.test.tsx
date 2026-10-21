// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraft } from '../src/shared/types'

const { runMock, cancelMock } = vi.hoisted(() => ({
  runMock: vi.fn(),
  cancelMock: vi.fn()
}))

vi.mock('../src/renderer/useLlmRun', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/renderer/useLlmRun')>()
  return {
    ...actual,
    useLlmRun: () => ({
      state: { running: null, streamText: '' },
      run: runMock,
      cancel: cancelMock
    })
  }
})

import { useTextTransform } from '../src/renderer/useTextTransform'
import { useStore } from '../src/renderer/store'

const info = { sawReasoning: false, truncated: false, reasoningTokens: 0 }

function respond(text: string, done = info): void {
  runMock.mockImplementation(
    async (
      _kind: string,
      _messages: unknown,
      options: { onDone?: (text: string, done: typeof info) => void }
    ) => {
      options.onDone?.(text, done)
      return text
    }
  )
}

function resetStore(intentText: string): void {
  const draft = createDraft('test-draft')
  draft.intentText = intentText
  useStore.setState({
    draft,
    uiLanguage: 'zh',
    notice: null,
    draftEpoch: 0
  })
}

beforeEach(() => {
  resetStore('嗯，那个，我想说一下这个安排。')
  runMock.mockReset()
  cancelMock.mockReset()
  ;(window as unknown as { preface: unknown }).preface = {
    getSettings: vi.fn(async () => ({ tidyUseStyleSamples: true })),
    listStyles: vi.fn(async () => ({ items: [] }))
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('优化表达', () => {
  it('直接替换原文，并可撤销', async () => {
    respond('我想说明一下这个安排。')
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.improve()
    })

    expect(runMock.mock.calls[0][0]).toBe('expression')
    expect(useStore.getState().draft.intentText).toBe('我想说明一下这个安排。')
    expect(result.current.canUndo).toBe(true)
    expect(result.current.undoKind).toBe('expression')

    act(() => result.current.undo())

    expect(useStore.getState().draft.intentText).toBe('嗯，那个，我想说一下这个安排。')
    expect(result.current.canUndo).toBe(false)
  })

  it('输出被截断时不覆盖原文', async () => {
    respond('被截断的结果', { ...info, truncated: true })
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.improve()
    })

    expect(useStore.getState().draft.intentText).toBe('嗯，那个，我想说一下这个安排。')
    expect(useStore.getState().notice?.text).toContain('截断')
    expect(result.current.canUndo).toBe(false)
  })

  it('空结果不覆盖原文', async () => {
    respond('   ')
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.improve()
    })

    expect(useStore.getState().draft.intentText).toBe('嗯，那个，我想说一下这个安排。')
    expect(result.current.canUndo).toBe(false)
  })

  it('等待期间原文被改动时丢弃结果', async () => {
    runMock.mockImplementation(
      async (
        _kind: string,
        _messages: unknown,
        options: { onDone?: (text: string, done: typeof info) => void }
      ) => {
        options.onDone?.('改写后的文字', info)
        useStore.getState().setIntentText('用户刚改的内容')
        return '改写后的文字'
      }
    )
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.improve()
    })

    expect(useStore.getState().draft.intentText).toBe('用户刚改的内容')
    expect(result.current.canUndo).toBe(false)
  })

  it('缺少 /命令 时先确认，确认后才替换', async () => {
    resetStore('请 /review 这段文字')
    respond('请检查这段文字')
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.improve()
    })

    expect(useStore.getState().draft.intentText).toBe('请 /review 这段文字')
    expect(result.current.pending?.issues[0].tokens).toEqual(['/review'])

    act(() => result.current.confirmReplace())

    expect(useStore.getState().draft.intentText).toBe('请检查这段文字')
    expect(result.current.canUndo).toBe(true)
  })

  it('取消确认时保留原文', async () => {
    resetStore('请 /review 这段文字')
    respond('请检查这段文字')
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.improve()
    })
    act(() => result.current.cancelReplace())

    expect(useStore.getState().draft.intentText).toBe('请 /review 这段文字')
    expect(result.current.pending).toBeNull()
    expect(useStore.getState().notice?.text).toBe('已保留原文。')
  })
})

describe('整理碎碎念的回归', () => {
  it('仍然调用 tidy，并且可以撤销', async () => {
    respond('整理后的文字')
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.tidy()
    })

    expect(runMock.mock.calls[0][0]).toBe('tidy')
    expect(useStore.getState().draft.intentText).toBe('整理后的文字')
    expect(result.current.undoKind).toBe('tidy')
  })

  it('缺少 /命令 时同样先确认', async () => {
    resetStore('帮我 /review 这个')
    respond('帮我检查这个')
    const { result } = renderHook(() => useTextTransform())

    await act(async () => {
      await result.current.tidy()
    })

    expect(result.current.pending?.kind).toBe('tidy')
    expect(useStore.getState().draft.intentText).toBe('帮我 /review 这个')
  })
})
