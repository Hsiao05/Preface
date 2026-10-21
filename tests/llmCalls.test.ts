import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: vi.fn() },
  app: { getPath: () => 'C:\\测试目录', isPackaged: false },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(''),
    decryptString: () => ''
  },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] }
}))

const { CALL_SPECS, tidyMaxTokens, translationMaxTokens } = await import(
  '../src/main/llm'
)

describe('模型调用规格', () => {
  it('翻译和优化表达都是非流式', () => {
    expect(CALL_SPECS.translate.stream).toBe(false)
    expect(CALL_SPECS.expression.stream).toBe(false)
  })

  it('翻译的默认输出预算比整理大（译文可能变长）', () => {
    expect(CALL_SPECS.translate.maxTokens).toBeGreaterThan(CALL_SPECS.tidy.maxTokens)
  })

  it('原有的整理仍保持流式', () => {
    expect(CALL_SPECS.tidy.stream).toBe(true)
  })
})

describe('翻译输出预算', () => {
  it('短文本至少给 800', () => {
    expect(translationMaxTokens('hi')).toBe(800)
  })

  it('按原文估算的三倍给，最多 8000', () => {
    expect(translationMaxTokens('a'.repeat(4000))).toBeGreaterThan(800)
    expect(translationMaxTokens('a'.repeat(100000))).toBe(8000)
  })

  it('优化表达沿用整理的预算函数（最少 500，最多 4000）', () => {
    expect(tidyMaxTokens('hi')).toBe(500)
    expect(tidyMaxTokens('a'.repeat(100000))).toBe(4000)
  })
})
