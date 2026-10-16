import { app } from 'electron'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  existsSync,
  copyFileSync,
  unlinkSync
} from 'fs'
import { join, dirname } from 'path'
import { log } from './logger'
import type { Draft } from '../shared/types'
import { draftSchema } from './draftSchema'

export { draftSchema }

const CURRENT = () => join(app.getPath('userData'), 'drafts', 'current.json')
const PREVIOUS = () => join(app.getPath('userData'), 'drafts', 'previous.json')

/** 上一次复制的时间，用于判断 24 小时提示条是否有效 */
const PREVIOUS_META = () => join(app.getPath('userData'), 'drafts', 'previous-meta.json')

/** 读取一个草稿文件。不存在或损坏时返回 null。 */
function readDraft(file: string): Draft | null {
  if (!existsSync(file)) return null
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    const parsed = draftSchema.safeParse(raw)
    if (!parsed.success) {
      log(`草稿文件校验失败，已备份: ${file}`)
      backup(file)
      return null
    }
    return parsed.data as Draft
  } catch {
    log(`草稿文件解析失败，已备份: ${file}`)
    backup(file)
    return null
  }
}

function backup(file: string): void {
  try {
    copyFileSync(file, `${file}.bak`)
  } catch {
    // 备份失败不影响启动
  }
}

/** 原子写入：先写临时文件再改名，避免中途崩溃留下半个文件。 */
function writeJson(file: string, data: unknown): void {
  const temp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(temp, file)
  } catch (error) {
    log(`写入草稿失败: ${String(error)}`)
  }
}

export function loadCurrentDraft(): Draft | null {
  return readDraft(CURRENT())
}

export function saveCurrentDraft(draft: Draft): void {
  writeJson(CURRENT(), draft)
}

/**
 * 复制成功后：把当前草稿另存为 previous，并记下时间。
 * 注意不清空当前草稿 —— 文档规定复制后不立即清空，只在下次呼出时才换新草稿。
 */
export function archiveDraft(draft: Draft): void {
  writeJson(PREVIOUS(), draft)
  writeJson(PREVIOUS_META(), { copiedAt: Date.now() })
}

/** 读取上一次已复制的草稿，以及它是否还在 24 小时内 */
export function loadPreviousDraft(): { draft: Draft; copiedAt: number; expired: boolean } | null {
  const draft = readDraft(PREVIOUS())
  if (!draft) return null

  let copiedAt = 0
  try {
    const meta = JSON.parse(readFileSync(PREVIOUS_META(), 'utf-8'))
    copiedAt = typeof meta.copiedAt === 'number' ? meta.copiedAt : 0
  } catch {
    copiedAt = 0
  }

  const DAY = 24 * 60 * 60 * 1000
  const expired = copiedAt > 0 && Date.now() - copiedAt > DAY

  return { draft, copiedAt, expired }
}

/** 清空上一次的草稿（用户选择不再恢复时） */
export function clearPreviousDraft(): void {
  for (const file of [PREVIOUS(), PREVIOUS_META()]) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch {
      // 忽略
    }
  }
}
