import { describe, expect, it } from 'vitest'
import { buildStatusText } from '../src/shared/statusText'

/**
 * 结果区状态条。
 *
 * 【为什么要测】
 * 「显示 Token 用量」这个开关原来在设置页里躺着，但没人读它 ——
 * 关掉之后用量照样显示。这类"设置项没接线"的毛病肉眼看不出来，
 * 只有测才拦得住。
 */

describe('状态条文字', () => {
  it('什么都没发生时返回 null（状态条留空但不消失）', () => {
    expect(buildStatusText({ resolvedMode: null, mode: 'auto' })).toBeNull()
  })

  it('显示模型选的模式', () => {
    expect(buildStatusText({ resolvedMode: 'simple', mode: 'simple' })).toBe('简单模式')
    expect(buildStatusText({ resolvedMode: 'markdown', mode: 'markdown' })).toBe('Markdown 模式')
  })

  it('自动模式下标注「自动判断」', () => {
    expect(buildStatusText({ resolvedMode: 'simple', mode: 'auto' })).toBe('简单模式（自动判断）')
  })

  it('显示 Token 用量', () => {
    const text = buildStatusText({
      resolvedMode: null,
      mode: 'auto',
      usage: { input: 1200, output: 340 }
    })
    expect(text).toContain('本次约')
    expect(text).toContain('1.5k')
  })

  it('推理模型额外提示', () => {
    const text = buildStatusText({ resolvedMode: null, mode: 'auto', sawReasoning: true })
    expect(text).toBe('模型带推理过程，消耗会增加')
  })

  it('多段之间用「 · 」连接', () => {
    const text = buildStatusText({
      resolvedMode: 'simple',
      mode: 'auto',
      usage: { input: 100, output: 100 },
      sawReasoning: true
    })
    expect(text).toBe('简单模式（自动判断） · 本次约 200 tokens · 模型带推理过程，消耗会增加')
  })
})

describe('「显示 Token 用量」开关', () => {
  it('默认显示', () => {
    const text = buildStatusText({
      resolvedMode: null,
      mode: 'auto',
      usage: { input: 100, output: 100 }
    })
    expect(text).toContain('tokens')
  })

  it('关掉之后不显示用量', () => {
    const text = buildStatusText({
      resolvedMode: null,
      mode: 'auto',
      usage: { input: 100, output: 100 },
      showTokenUsage: false
    })
    expect(text).toBeNull()
  })

  it('关掉用量不影响模式和推理提示', () => {
    const text = buildStatusText({
      resolvedMode: 'simple',
      mode: 'auto',
      usage: { input: 100, output: 100 },
      sawReasoning: true,
      showTokenUsage: false
    })
    expect(text).toBe('简单模式（自动判断） · 模型带推理过程，消耗会增加')
    expect(text).not.toContain('tokens')
  })

  it('用量缺失时不会崩', () => {
    expect(buildStatusText({ resolvedMode: null, mode: 'auto', usage: null })).toBeNull()
    expect(buildStatusText({ resolvedMode: null, mode: 'auto', usage: {} })).toBe(
      '本次约 0 tokens'
    )
  })
})
