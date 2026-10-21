import type { CorpusResource, FileResource, Target } from './types'
import { findRefs } from './refs'
import { translate, type UiLanguage } from './i18n'

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
export function preCopyCheck(
  input: PreCopyCheckInput,
  language: UiLanguage = 'zh'
): PreCopyResult {
  const { files, corpora, body, target } = input
  const issues: PreCopyIssue[] = []
  const t = (key: Parameters<typeof translate>[1], params?: Record<string, string | number>): string =>
    translate(language, key, params)
  const separator = language === 'en' ? ', ' : '、'
  const and = language === 'en' ? ' and ' : ' 和 '

  const allIds = new Set([...files.map((f) => f.id), ...corpora.map((c) => c.id)])
  const referenced = new Set(findRefs(body).map((r) => r.slice(1)))

  // 1. 失效引用
  const brokenRefs = [...referenced].filter((id) => !allIds.has(id))
  if (brokenRefs.length > 0) {
    issues.push({
      kind: 'missing-ref',
      title: t('preCopy.brokenTitle'),
      detail: t('preCopy.brokenDetail', {
        refs: brokenRefs.map((id) => '@' + id).join(separator)
      }),
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
      return `${id} ${corpus?.title.trim() || t('resource.untitledCorpus')}`
    })
    issues.push({
      kind: 'unreferenced',
      title: t('preCopy.unreferencedTitle'),
      detail: t('preCopy.unreferencedDetail', { names: names.join(separator) }),
      action: 'include-as-background',
      ids: unreferencedIds
    })
  }

  // 3. 文件不存在
  const missingFiles = files.filter((f) => input.missingFileIds?.has(f.id))
  if (missingFiles.length > 0) {
    issues.push({
      kind: 'missing-file',
      title: t('preCopy.missingFileTitle'),
      detail: t('preCopy.missingFileDetail', {
        names: missingFiles.map((f) => `${f.id} ${f.name}`).join(separator)
      }),
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
      title: t('preCopy.tooLongTitle'),
      detail: t('preCopy.tooLongDetail', {
        count: roughLength.toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')
      })
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
          title: t('preCopy.duplicateTitle'),
          detail: t('preCopy.duplicateDetail', {
            ids: ids.join(and),
            name
          }),
          ids
        })
      }
    }
  }

  return { issues, unreferencedIds }
}
