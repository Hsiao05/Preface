/**
 * 把一段文字追加到原文末尾。
 *
 * 转录结果按用户的选择总是追加到末尾，不按光标位置插。
 * 中间空一行，读起来是两段。
 */
export function appendWithSpacing(existing: string, addition: string): string {
  const add = addition.trim()
  if (!add) return existing
  // 原文是空的（或只有空白）：直接就是这段文字
  if (!existing.trim()) return add

  const trailing = existing.match(/(?:\r?\n)+$/)?.[0] ?? ''
  if (trailing === '') return `${existing}\n\n${add}`
  if (trailing.endsWith('\n\n')) return existing + add
  return `${existing}\n${add}`
}
