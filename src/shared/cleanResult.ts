import { stripMarkdown, stripPreamble } from './stripMarkdown'
import type { ResolvedMode } from './types'

/**
 * 优化结果的统一清理。
 *
 * - 普通模式：先去掉开场白，简单模式再兜底去掉残留 Markdown。
 * - 完整模板套用：模板正文的格式优先，**不做** Markdown 剥离，也不去掉
 *   开场白 —— 模板完全可能以固定文案开头，那些字是用户要的，不能删。
 */
export function cleanResultText(
  text: string,
  mode: ResolvedMode | null,
  options: { template?: boolean } = {}
): string {
  if (options.template) return text.trim()
  const body = stripPreamble(text)
  return mode === 'simple' ? stripMarkdown(body) : body
}
