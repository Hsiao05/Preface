import type { CorpusResource, FileResource, Target } from './types'
import { findRefs } from './refs'

export interface PreCopyIssue {
  kind: 'missing-ref' | 'missing-file' | 'unreferenced' | 'too-long' | 'duplicate-name'
  title: string
  detail: string
  /** 可以在确认框里当场处理的问题 */
  action?: 'include-as-background' | 'skip'
  /** 涉及到的资料编号 */
  ids?: string[]
}

export interface PreCopyCheckInput {
  files: FileResource[]
  corpora: CorpusResource[]
  body: string
  target: Target
  /** 已确认不存在的文件编号 */
  missingFileIds?: Set<string>
  lengthWarnThreshold?: number
}

export interface PreCopyResult {
  issues: PreCopyIssue[]
  /** 有资料没被引用时，这些编号需要用户决定是否附带 */
  unreferencedIds: string[]
}

/**
 * 复制前的四项检查（文档第四节）：
 * 1. 文中有失效引用
 * 2. 有资料没被引用
 * 3. 有文件已经不存在了
 * 4. 最终文字的总长度超过阈值
 */
export function preCopyCheck(input: PreCopyCheckInput): PreCopyResult {
  const { files, corpora, body, target } = input
  const issues: PreCopyIssue[] = []

  const allIds = new Set([...files.map((f) => f.id), ...corpora.map((c) => c.id)])
  const referenced = new Set(findRefs(body).map((r) => r.slice(1)))

  // 1. 失效引用
  const brokenRefs = [...referenced].filter((id) => !allIds.has(id))
  if (brokenRefs.length > 0) {
    issues.push({
      kind: 'missing-ref',
      title: '文中有失效引用',
      detail: `${brokenRefs.map((id) => '@' + id).join('、')} 指向的资料已经不存在了。`,
      ids: brokenRefs
    })
  }

  // 2. 有资料没被引用
  const unreferencedIds = [...allIds].filter((id) => !referenced.has(id))
  if (unreferencedIds.length > 0) {
    const names = unreferencedIds.map((id) => {
      const file = files.find((f) => f.id === id)
      if (file) return `${id} ${file.name}`
      const corpus = corpora.find((c) => c.id === id)
      return `${id} ${corpus?.title.trim() || '未命名语料'}`
    })
    issues.push({
      kind: 'unreferenced',
      title: '有资料没被引用',
      detail: `${names.join('、')} 没有被原文引用。要不要作为背景资料一起附带？`,
      action: 'include-as-background',
      ids: unreferencedIds
    })
  }

  // 3. 文件不存在
  const missingFiles = files.filter((f) => input.missingFileIds?.has(f.id))
  if (missingFiles.length > 0) {
    issues.push({
      kind: 'missing-file',
      title: '有文件已经不存在了',
      detail: `${missingFiles.map((f) => `${f.id} ${f.name}`).join('、')} 已经被移动或删除。`,
      ids: missingFiles.map((f) => f.id)
    })
  }

  // 4. 长度超限（这里只估个大概，精确长度由 assemblePrompt 算出）
  const threshold = input.lengthWarnThreshold ?? 60000
  const roughLength =
    body.length + corpora.reduce((sum, c) => sum + c.content.length, 0)
  if (threshold > 0 && roughLength > threshold) {
    issues.push({
      kind: 'too-long',
      title: '内容较长',
      detail: `大约 ${roughLength.toLocaleString('zh-CN')} 字，部分 Agent 可能处理不完整。`
    })
  }

  // 网页端重名
  if (target === 'web') {
    const byName = new Map<string, string[]>()
    for (const file of files) {
      const list = byName.get(file.name) ?? []
      list.push(file.id)
      byName.set(file.name, list)
    }
    for (const [name, ids] of byName) {
      if (ids.length > 1) {
        issues.push({
          kind: 'duplicate-name',
          title: '有文件重名',
          detail: `${ids.join(' 和 ')} 都叫「${name}」。网页端靠文件名识别附件，建议改名或删掉其中一个。`,
          ids
        })
      }
    }
  }

  return { issues, unreferencedIds }
}
