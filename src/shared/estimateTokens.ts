/**
 * Token 估算。
 *
 * 方法（文档第八节）：中文字符数 × 0.7，加上其他字符数 ÷ 4，结果取整。
 * 不同模型的计算方式不同，这个值只用于相互比较，界面上要标明"约"。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0

  // 中日韩统一表意文字，以及中文标点
  const cjkPattern =
    /[㐀-䶿一-鿿豈-﫿　-〿＀-￯]/g

  const cjkCount = (text.match(cjkPattern) ?? []).length
  const otherCount = text.length - cjkCount

  return Math.round(cjkCount * 0.7 + otherCount / 4)
}

/** 带"约"字的显示形式 */
export function formatTokenEstimate(text: string): string {
  return `约 ${estimateTokens(text)} tokens`
}

/** 把 token 数显示成 1.6k 这样的形式 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens)
  return `${(tokens / 1000).toFixed(1)}k`
}
