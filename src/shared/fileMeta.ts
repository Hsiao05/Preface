import { stat } from 'fs/promises'
import { basename, extname } from 'path'
import type { FileResource } from './types'

/**
 * 文件元信息。
 *
 * 【重要】这里只允许读取文件的元信息（fs.stat）。
 * 绝对不允许读取文件内容 —— 不出现 readFile、createReadStream 之类的调用。
 * 理由：文件可能有文本无法替代的功能（格式、批注、公式、版式），
 * 转成文本会丢失信息，还会让 AI 误解用户的意图。
 */

export interface FileStatResult {
  path: string
  exists: boolean
  name?: string
  ext?: string
  size?: number
  mtime?: number
}

/** 读取一个文件的元信息。文件不存在或没有权限时 exists 为 false。 */
export async function statFile(path: string): Promise<FileStatResult> {
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      return { path, exists: false }
    }
    return {
      path,
      exists: true,
      name: basename(path),
      ext: extname(path).replace(/^\./, '').toLowerCase(),
      size: info.size,
      mtime: info.mtimeMs
    }
  } catch {
    return { path, exists: false }
  }
}

/** 批量读取元信息 */
export async function statFiles(paths: string[]): Promise<FileStatResult[]> {
  return Promise.all(paths.map(statFile))
}

/**
 * 把一批路径转成 FileResource，自动跳过重复和不存在的文件。
 * 编号从 startNo 开始递增，删除后的编号不回收。
 */
export async function toFileResources(
  paths: string[],
  existing: FileResource[],
  startNo: number
): Promise<{ added: FileResource[]; nextNo: number; skipped: string[] }> {
  const added: FileResource[] = []
  const skipped: string[] = []
  // 同一路径只保留一份（比较时忽略大小写，Windows 不区分）
  const known = new Set(existing.map((f) => f.path.toLowerCase()))
  let no = startNo

  for (const path of paths) {
    const key = path.toLowerCase()
    if (known.has(key)) {
      skipped.push(path)
      continue
    }

    const info = await statFile(path)
    if (!info.exists) {
      skipped.push(path)
      continue
    }

    known.add(key)
    added.push({
      id: `F${no}`,
      name: info.name!,
      path,
      ext: info.ext!,
      size: info.size!,
      mtime: info.mtime!,
      note: '',
      permission: 'editable'
    })
    no++
  }

  return { added, nextNo: no, skipped }
}

/** 人类可读的文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
