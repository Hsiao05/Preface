import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { join } from 'path'
import { log } from './logger'
import { draftSchema } from './draftSchema'
import type { Draft } from '../shared/types'

/**
 * 草稿历史（"找回之前的内容"）。
 *
 * 每次复制成功、或者用户点一键清空时，都会在这里存一份快照。
 * 设置页的"通用"标签里可以查看列表、恢复某一版、清空全部，
 * 以及设置保留时长（超过时间的快照自动删除）。
 */

/** 快照文件里除了草稿本身，还记一些用于展示的元信息 */
export interface Snapshot {
  id: string
  /** 保存时间 */
  savedAt: number
  /** 保存原因 */
  reason: 'copied' | 'cleared' | 'manual'
  draft: Draft
}

export interface SnapshotSummary {
  id: string
  savedAt: number
  reason: 'copied' | 'cleared' | 'manual'
  /** 原文前 60 字，供列表显示 */
  preview: string
  fileCount: number
  corpusCount: number
  hasResult: boolean
  /** 原文总字数 */
  intentChars: number
}

/** 保留时长的可选值（分钟）。0 表示永不删除。 */
export const RETENTION_OPTIONS = [10, 30, 60, 120, 300, 720, 1440, 0] as const
export type RetentionMinutes = (typeof RETENTION_OPTIONS)[number]

const HISTORY_DIR = () => join(app.getPath('userData'), 'drafts', 'history')

/** 最多保留多少份快照，防止无限增长 */
const MAX_SNAPSHOTS = 100

function ensureDir(): void {
  try {
    mkdirSync(HISTORY_DIR(), { recursive: true })
  } catch {
    // 忽略
  }
}

/** 生成快照文件名：按时间排序时天然有序 */
function snapshotFileName(savedAt: number, reason: string): string {
  return `${savedAt}_${reason}_${Math.random().toString(36).slice(2, 8)}.json`
}

/** 保存一份快照 */
export function saveSnapshot(draft: Draft, reason: Snapshot['reason']): Snapshot | null {
  // 空草稿没有保存价值
  const hasContent =
    draft.intentText.trim().length > 0 ||
    draft.files.length > 0 ||
    draft.corpora.length > 0 ||
    Boolean(draft.result?.text)

  if (!hasContent) return null

  ensureDir()

  const savedAt = Date.now()
  const id = snapshotFileName(savedAt, reason).replace('.json', '')
  const snapshot: Snapshot = { id, savedAt, reason, draft }

  const file = join(HISTORY_DIR(), `${id}.json`)
  const temp = `${file}.tmp`

  try {
    writeFileSync(temp, JSON.stringify(snapshot), 'utf-8')
    renameSync(temp, file)
    log(`已保存草稿快照（${reason}）`)
    pruneByCount()
    return snapshot
  } catch (error) {
    log(`保存草稿快照失败: ${String(error)}`)
    return null
  }
}

/** 读一个快照文件 */
function readSnapshot(file: string): Snapshot | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    if (typeof raw !== 'object' || raw === null) return null

    const parsed = draftSchema.safeParse(raw.draft)
    if (!parsed.success) return null

    return {
      id: typeof raw.id === 'string' ? raw.id : file,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
      reason:
        raw.reason === 'copied' || raw.reason === 'cleared' || raw.reason === 'manual'
          ? raw.reason
          : 'manual',
      draft: parsed.data as Draft
    }
  } catch {
    return null
  }
}

/** 列出全部快照文件（按时间从新到旧） */
function listFiles(): string[] {
  const dir = HISTORY_DIR()
  if (!existsSync(dir)) return []

  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => join(dir, name))
      .sort((a, b) => {
        // 文件名以时间戳开头，倒序就是最新在前
        const ta = Number(a.split(/[\\/]/).pop()?.split('_')[0] ?? 0)
        const tb = Number(b.split(/[\\/]/).pop()?.split('_')[0] ?? 0)
        return tb - ta
      })
  } catch {
    return []
  }
}

/** 从草稿里提取摘要，用于列表显示 */
function summarize(snapshot: Snapshot): SnapshotSummary {
  const { draft } = snapshot
  const text = draft.intentText.trim()

  return {
    id: snapshot.id,
    savedAt: snapshot.savedAt,
    reason: snapshot.reason,
    preview: text.slice(0, 60),
    fileCount: draft.files.length,
    corpusCount: draft.corpora.length,
    hasResult: Boolean(draft.result?.text),
    intentChars: text.length
  }
}

/** 列出全部快照摘要，并顺手清掉过期的 */
export function listSnapshots(retentionMinutes: number): SnapshotSummary[] {
  pruneByRetention(retentionMinutes)

  const summaries: SnapshotSummary[] = []
  for (const file of listFiles()) {
    const snapshot = readSnapshot(file)
    if (snapshot) summaries.push(summarize(snapshot))
  }
  return summaries
}

/** 取一份快照的完整草稿 */
export function loadSnapshot(id: string): Draft | null {
  // id 里可能带路径分隔符，只取文件名部分，防止越界读取
  const safe = id.replace(/[\\/]/g, '')
  const file = join(HISTORY_DIR(), `${safe}.json`)
  const snapshot = readSnapshot(file)
  return snapshot?.draft ?? null
}

/** 删除一份快照 */
export function deleteSnapshot(id: string): boolean {
  const safe = id.replace(/[\\/]/g, '')
  const file = join(HISTORY_DIR(), `${safe}.json`)
  try {
    if (existsSync(file)) unlinkSync(file)
    return true
  } catch {
    return false
  }
}

/** 清空全部快照 */
export function clearAllSnapshots(): number {
  let count = 0
  for (const file of listFiles()) {
    try {
      unlinkSync(file)
      count++
    } catch {
      // 忽略
    }
  }
  return count
}

/** 按保留时长清理。retentionMinutes 为 0 表示永不删除。 */
export function pruneByRetention(retentionMinutes: number): number {
  if (retentionMinutes <= 0) return 0

  const cutoff = Date.now() - retentionMinutes * 60 * 1000
  let removed = 0

  for (const file of listFiles()) {
    const name = file.split(/[\\/]/).pop() ?? ''
    const timestamp = Number(name.split('_')[0] ?? 0)

    if (timestamp > 0 && timestamp < cutoff) {
      try {
        unlinkSync(file)
        removed++
      } catch {
        // 忽略
      }
    }
  }

  if (removed > 0) log(`按保留时长清理了 ${removed} 份快照`)
  return removed
}

/** 超过上限时删掉最旧的 */
function pruneByCount(): void {
  const files = listFiles()
  if (files.length <= MAX_SNAPSHOTS) return

  // listFiles 已经按时间倒序，末尾是最旧的
  for (const file of files.slice(MAX_SNAPSHOTS)) {
    try {
      unlinkSync(file)
    } catch {
      // 忽略
    }
  }
}
