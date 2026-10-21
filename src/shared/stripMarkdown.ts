/**
 * 去掉残留的 Markdown 符号。只用于"简单模式"的兜底清理。
 *
 * 【边界】只处理这几类：
 * - 行首的列表符号（- * +）
 * - 行首的标题符号（#）
 * - 成对的加粗符号（**）
 * - 表格分隔行（|---|）
 *
 * 绝不能误删：
 * - @ 引用
 * - 正文里的星号或连字符（例如 "3-5 天"、"2 * 3"）
 * - 行内的代码反引号之外的内容
 */
export function stripMarkdown(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []

  for (const line of lines) {
    // 表格分隔行整行丢掉：|---|:--:|---|
    if (/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-') && line.includes('|')) {
      continue
    }

    let result = line

    // 行首标题符号：# 到 ######，后面要有空格
    result = result.replace(/^\s{0,3}#{1,6}\s+/, '')

    // 行首列表符号：- * + 后面要有空格
    result = result.replace(/^(\s*)[-*+]\s+/, '$1')

    // 行首有序列表保持原样（1. 2. 3. 是文档要求保留的写法）

    // 成对的加粗符号：**文字** → 文字
    result = result.replace(/\*\*(.+?)\*\*/g, '$1')

    out.push(result)
  }

  return out.join('\n')
}

/**
 * 只去掉包裹**整段结果**的一层 Markdown 代码围栏，保留正文里的 Markdown。
 *
 * 翻译和优化表达要求模型直接输出正文，但个别模型仍会包一层围栏。
 * 这里不剥离正文内的标题、列表等符号。
 */
export function stripOuterCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/)
  return match ? match[1].trim() : trimmed
}

/**
 * 去掉结果开头可能出现的开场白，以及包裹全文的代码块标记。
 * 例如"以下是优化后的提示词："这样的句子。
 */
export function stripPreamble(text: string): string {
  let result = text.trim()

  // 去掉包裹全文的 ``` 代码块
  const fenceMatch = result.match(/^```[a-zA-Z]*\n([\s\S]*)\n```$/)
  if (fenceMatch) {
    result = fenceMatch[1].trim()
  }

  // 去掉开头的常见开场白（只处理第一行）
  const lines = result.split('\n')
  if (lines.length > 1) {
    const first = lines[0].trim()
    const isPreamble =
      /^(以下是|下面是|这是|根据你的要求|已按|按照你的要求)/.test(first) &&
      first.length < 40 &&
      first.endsWith('：')
    if (isPreamble) {
      lines.shift()
      // 开场白后面如果跟着空行也一并去掉
      while (lines.length > 0 && lines[0].trim() === '') lines.shift()
      result = lines.join('\n')
    }
  }

  return result.trim()
}
