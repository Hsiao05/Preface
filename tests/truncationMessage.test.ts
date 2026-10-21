import { describe, expect, it, vi } from 'vitest'

/**
 * 推理模型导致输出截断时的提示语。
 *
 * 用户要求：必须明确给出两条出路 —— 换非推理模型，或调大最大输出长度。
 */

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (v: unknown) => ({ current: v }),
  useState: (v: unknown) => [v, () => {}]
}))

const { buildTruncatedMessage, buildEmptyResultMessage } = await import(
  '../src/renderer/useLlmRun'
)

describe('输出被截断时的提示', () => {
  it('推理模型截断：建议换非推理模型', () => {
    const message = buildTruncatedMessage({
      sawReasoning: true,
      truncated: true,
      reasoningTokens: 2800
    })

    expect(message).toContain('截断')
    expect(message).toContain('推理')
    expect(message).toContain('deepseek-chat')
    expect(message).toMatch(/2,?800/)
  })

  it('普通模型截断：建议调大最大输出长度', () => {
    const message = buildTruncatedMessage({
      sawReasoning: false,
      truncated: true,
      reasoningTokens: 0
    })

    expect(message).toContain('截断')
    expect(message).toContain('最大输出长度')
  })

  it('推理模型没给 token 数时也能正常提示', () => {
    const message = buildTruncatedMessage({
      sawReasoning: true,
      truncated: true,
      reasoningTokens: 0
    })
    expect(message).toContain('deepseek-chat')
    expect(message).not.toContain('undefined')
  })
})

describe('结果为空时的提示', () => {
  it('推理模型占满预算：给出换模型或调大上限两条路', () => {
    const message = buildEmptyResultMessage({
      sawReasoning: true,
      truncated: true,
      reasoningTokens: 3000
    })

    expect(message).toContain('推理')
    expect(message).toContain('deepseek-chat')
    expect(message).toContain('最大输出长度')
    expect(message).toContain('原文保持不变')
  })

  it('普通模型没返回内容：只建议重试', () => {
    const message = buildEmptyResultMessage({
      sawReasoning: false,
      truncated: false,
      reasoningTokens: 0
    })

    expect(message).toContain('没有返回内容')
    expect(message).toContain('原文保持不变')
  })
})
