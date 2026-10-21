/**
 * 斜杠命令的识别与校验。
 *
 * 用户原文里可能有 `/review`、`/xxx-skill`、`/plugin:skill` 这类
 * 调用 Skill 或 Agent 的指令。优化、整理之后必须原样保留，
 * 否则用户复制出去就没法执行了。
 *
 * 这里只做"事后检查"：比对原文和结果里的命令，缺了或多了就提示。
 * 不额外调用模型去修 —— 真正的保障是提示词里的"保留命令"规则。
 */

import { translate, type UiLanguage } from './i18n'

/**
 * 一个候选命令：`/` 前面必须是行首或空白、左括号、引号、反引号。
 *
 * `/` 后面第一个字符必须是字母（含中文），后面允许字母、数字、
 * 下划线、连字符和冒号（`/plugin:skill`）。
 * 用捕获组而不是后行断言，兼容性更稳。
 */
const CANDIDATE = /(^|[\s([`"'（「“‘])\/(\p{L}[\p{L}\p{N}_:-]*)/gmu

/**
 * 找出文本里的斜杠命令，按出现顺序去重。
 *
 * 会排除这些容易误判的写法：
 *   - URL            https://example.com/a
 *   - 日期           2024/10/16
 *   - Unix 路径      /usr/bin
 *   - HTML 标签      </div>
 *   - Markdown 链接  [文字](/路径)
 *   - 文件名         /review.md
 *   - 分数           1/2
 */
export function findSlashCommands(text: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()

  // 每次调用都从头开始，避免上次的 lastIndex 影响结果
  CANDIDATE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = CANDIDATE.exec(text)) !== null) {
    const prefix = match[1]
    const name = match[2]
    const slashIndex = match.index + prefix.length
    const end = slashIndex + 1 + name.length
    const after = text[end] ?? ''
    const next = text[end + 1] ?? ''

    // Markdown 链接：[文字](/路径)
    if (prefix === '(' && text[slashIndex - 1] === ']') continue
    // 路径的中间段：/usr/bin
    if (after === '/') continue
    // 文件名：/review.md
    if (after === '.' && /\p{L}/u.test(next)) continue
    // 协议样写法：/review://
    if (after === ':' && next === '/') continue

    const command = `/${name}`
    if (!seen.has(command)) {
      seen.add(command)
      found.push(command)
    }
  }

  return found
}

/** 原文有、结果里没有的命令（要求逐字一致，区分大小写） */
export function missingCommands(source: string, result: string): string[] {
  const inResult = new Set(findSlashCommands(result))
  return findSlashCommands(source).filter((command) => !inResult.has(command))
}

/** 结果里多出来的命令 */
export function extraCommands(source: string, result: string): string[] {
  const inSource = new Set(findSlashCommands(source))
  return findSlashCommands(result).filter((command) => !inSource.has(command))
}

/**
 * 拼一句给用户看的提示。没有问题返回 null。
 * 只提示，不阻止保存，也不额外调用模型。
 */
export function buildCommandWarning(
  source: string,
  result: string,
  language: UiLanguage = 'zh'
): string | null {
  const missing = missingCommands(source, result)
  const extra = extraCommands(source, result)
  if (missing.length === 0 && extra.length === 0) return null

  const separator = language === 'en' ? ', ' : '、'
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(
      translate(language, 'command.missing', { tokens: missing.join(separator) })
    )
  }
  if (extra.length > 0) {
    parts.push(
      translate(language, 'command.extra', { tokens: extra.join(separator) })
    )
  }
  return parts.join(' ')
}
