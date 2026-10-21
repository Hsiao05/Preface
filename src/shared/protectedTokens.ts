import { extraCommands, findSlashCommands, missingCommands } from './commands'
import { findRefs } from './refs'

/**
 * 改写或翻译后必须原样保留的 token。
 *
 * 程序认识的只有 /命令 和 @F/C 编号；代码、URL、路径主要靠提示词约束。
 * 这里只做第二道检查，命中时交给用户确认。
 */
export interface ProtectedTokenIssue {
  kind: 'missing-command' | 'extra-command' | 'missing-ref' | 'extra-ref'
  tokens: string[]
}

export function findProtectedTokenIssues(source: string, result: string): ProtectedTokenIssue[] {
  const issues: ProtectedTokenIssue[] = []

  const missing = missingCommands(source, result)
  if (missing.length > 0) issues.push({ kind: 'missing-command', tokens: missing })

  const extra = extraCommands(source, result)
  if (extra.length > 0) issues.push({ kind: 'extra-command', tokens: extra })

  const sourceRefs = new Set(findRefs(source))
  const resultRefs = new Set(findRefs(result))
  const missingRefs = [...sourceRefs].filter((ref) => !resultRefs.has(ref))
  if (missingRefs.length > 0) issues.push({ kind: 'missing-ref', tokens: missingRefs })

  const extraRefs = [...resultRefs].filter((ref) => !sourceRefs.has(ref))
  if (extraRefs.length > 0) issues.push({ kind: 'extra-ref', tokens: extraRefs })

  return issues
}

export { findSlashCommands }
