import { findRefs } from './refs'
import type { CorpusResource, FileResource } from './types'

/**
 * @ 引用校验（文档第六节第五步）。
 *
 * 规则：
 * 1. 原文中的每个 @编号都必须出现在结果里
 * 2. 结果里不能出现资料清单之外的编号
 *
 * 不满足时，程序先自动补救一次（追加一条消息让模型修正）；
 * 补救后仍不满足，就保留结果并提示用户检查。
 */

export interface RefCheckInput {
  /** 原文（意图文本） */
  source: string
  /** 模型输出的结果 */
  result: string
  files: FileResource[]
  corpora: CorpusResource[]
}

export interface RefCheckResult {
  ok: boolean
  /** 原文里有、结果里缺的编号（带 @） */
  missing: string[]
  /** 结果里有、但清单里没有的编号（带 @） */
  unknown: string[]
  /** 给模型看的补救消息，ok 为 true 时是空字符串 */
  remedyMessage: string
}

export function validateRefs(input: RefCheckInput): RefCheckResult {
  const { source, result, files, corpora } = input

  // 清单里允许出现的编号
  const known = new Set([...files.map((f) => f.id), ...corpora.map((c) => c.id)])

  const sourceRefs = findRefs(source)
  const resultRefs = findRefs(result)

  // 原文里有、结果里缺的
  const missing = sourceRefs.filter((ref) => !resultRefs.includes(ref))

  // 结果里有、清单里没有的（去掉 @ 再比）
  const unknown = resultRefs.filter((ref) => !known.has(ref.slice(1)))

  if (missing.length === 0 && unknown.length === 0) {
    return { ok: true, missing: [], unknown: [], remedyMessage: '' }
  }

  // 拼出给模型的补救要求
  const parts: string[] = []
  if (missing.length > 0) {
    parts.push(`结果中缺少 ${missing.join('、')}`)
  }
  if (unknown.length > 0) {
    parts.push(`结果中出现了不存在的 ${unknown.join('、')}`)
  }

  const remedyMessage = `${parts.join('，')}。请修正后重新输出【结果】。`

  return { ok: false, missing, unknown, remedyMessage }
}

/**
 * 找出结果里引用了不存在的编号的位置，供界面标黄。
 * 返回每个失效引用在结果文本里的起止位置。
 */
export function findUnknownRefRanges(
  result: string,
  knownIds: Set<string>
): Array<{ start: number; end: number; ref: string }> {
  const ranges: Array<{ start: number; end: number; ref: string }> = []
  const pattern = /@[FC]\d+/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(result)) !== null) {
    const ref = match[0]
    if (!knownIds.has(ref.slice(1))) {
      ranges.push({ start: match.index, end: match.index + ref.length, ref })
    }
  }

  return ranges
}
