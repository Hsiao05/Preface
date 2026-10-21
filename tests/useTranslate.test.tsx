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

import { useTranslate } from '../src/renderer/useTranslate'
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

function resetStore(intentText = 'Hello /review @F1', result: ReturnType<typeof createDraft>['result'] = null): void {
  const draft = createDraft('test-draft')
  draft.intentText = intentText
  draft.result = result
  useStore.setState({
    draft,
    uiLanguage: 'zh',
    notice: null,
    draftEpoch: 0
  })
}

beforeEach(() => {
  resetStore()
  runMock.mockReset()
  cancelMock.mockReset()
  ;(window as unknown as { preface: unknown }).preface = {
    getSettings: vi.fn(async () => ({ translationTarget: 'fr' })),
    listStyles: vi.fn(async () => ({ items: [] }))
  }
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('翻译替换与撤销', () => {
  it('翻译原文后替换全文，并进入 5 秒撤销状态', async () => {
    respond('Bonjour /review @F1')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })

    expect(useStore.getState().draft.intentText).toBe('Bonjour /review @F1')
    expect(result.current.undo?.pane).toBe('source')
    expect(result.current.secondsLeft).toBe(5)
    expect(result.current.targetLabel).toBe('法语')
  })

  it('撤销还原翻译前的原文，并恢复结果的过期标记', async () => {
    resetStore('Hello /review @F1', {
      text: '旧结果',
      editedByUser: false,
      stale: false
    })
    // 原文一改，结果本来会被标记为过期；撤销要恢复翻译前的状态
    respond('Bonjour /review @F1')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })
    expect(useStore.getState().draft.result?.stale).toBe(true)

    act(() => result.current.undoNow())

    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(useStore.getState().draft.result?.stale).toBe(false)
    expect(result.current.undo).toBeNull()
  })

  it('翻译结果页时精确恢复旧的 result 对象', async () => {
    resetStore('原文', { text: 'Hello', editedByUser: false, stale: false })
    respond('Bonjour')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('result')
    })

    expect(useStore.getState().draft.result).toEqual({
      text: 'Bonjour',
      editedByUser: true,
      stale: false
    })

    act(() => result.current.undoNow())

    expect(useStore.getState().draft.result).toEqual({
      text: 'Hello',
      editedByUser: false,
      stale: false
    })
  })

  it('5 秒后撤销状态自动消失', async () => {
    vi.useFakeTimers()
    respond('Bonjour /review @F1')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })
    expect(result.current.undo).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(5000)
    })

    expect(result.current.undo).toBeNull()
  })
})

describe('不覆盖原文的情况', () => {
  it('输出被截断时不替换', async () => {
    respond('Bonjour', { ...info, truncated: true })
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })

    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(useStore.getState().notice?.text).toContain('截断')
    expect(result.current.undo).toBeNull()
  })

  it('空结果不替换', async () => {
    respond('   ')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })

    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(useStore.getState().notice).not.toBeNull()
  })

  it('译文与原文相同时不替换', async () => {
    respond('Hello /review @F1')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })

    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(useStore.getState().notice?.text).toContain('已经是')
  })

  it('等待期间原文被改动时丢弃结果', async () => {
    runMock.mockImplementation(
      async (
        _kind: string,
        _messages: unknown,
        options: { onDone?: (text: string, done: typeof info) => void }
      ) => {
        options.onDone?.('Bonjour', info)
        useStore.getState().setIntentText('用户刚改的内容')
        return 'Bonjour'
      }
    )
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })

    expect(useStore.getState().draft.intentText).toBe('用户刚改的内容')
    expect(useStore.getState().notice?.text).toContain('已丢弃')
  })
})

describe('命令与引用保护', () => {
  it('缺少命令或引用时先确认，确认后才替换', async () => {
    respond('Bonjour')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })

    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(result.current.pending?.issues).toHaveLength(2)
    expect(result.current.pending?.issues[0].tokens).toEqual(['/review'])

    act(() => result.current.confirmReplace())

    expect(useStore.getState().draft.intentText).toBe('Bonjour')
    expect(result.current.undo?.original).toBe('Hello /review @F1')
  })

  it('取消确认时保留原文', async () => {
    respond('Bonjour')
    const { result } = renderHook(() => useTranslate())

    await act(async () => {
      await result.current.translate('source')
    })
    act(() => result.current.cancelReplace())

    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(result.current.pending).toBeNull()
    expect(useStore.getState().notice?.text).toBe('已保留原文。')
  })
})

describe('取消', () => {
  it('取消翻译后不替换、不留撤销状态', async () => {
    let resolveRun: ((value: string | null) => void) | null = null
    runMock.mockReturnValue(
      new Promise<string | null>((resolve) => {
        resolveRun = resolve
      })
    )
    const { result } = renderHook(() => useTranslate())

    act(() => {
      void result.current.translate('source')
    })
    act(() => result.current.cancel())

    await act(async () => {
      resolveRun?.(null)
    })

    expect(cancelMock).toHaveBeenCalled()
    expect(useStore.getState().draft.intentText).toBe('Hello /review @F1')
    expect(result.current.runningPane).toBeNull()
    expect(result.current.undo).toBeNull()
  })
})
