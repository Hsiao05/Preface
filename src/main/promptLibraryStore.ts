import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { z } from 'zod'
import { log } from './logger'
import { mainT } from './i18n'
import {
  PROMPT_CONTENT_MAX,
  PROMPT_TITLE_MAX,
  normalizePromptTitle,
  type PromptLibraryItem
} from '../shared/promptLibrary'

/**
 * 「我的 Prompt 库」的存储。
 *
 * 和 stylesStore 是两回事：这里存的是用户自己长期积累的成熟提示词，
 * 不参与内置版本升级，也不会被导入导出风格时连带覆盖。
 *
 * 几条硬规则（都是为了别把用户攒下来的东西弄丢）：
 * - 写盘成功之后才更新内存缓存；写失败要明确报错，不能假报成功。
 * - 文件损坏或版本不认识时明确报错，**保留原文件**，不静默重置成空库。
 * - 所有写操作串行执行，避免两次保存互相覆盖。
 */

const SCHEMA_VERSION = 1

const itemSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().max(PROMPT_TITLE_MAX),
  content: z.string().min(1).max(PROMPT_CONTENT_MAX),
  titleSource: z.enum(['user', 'ai', 'none']),
  createdAt: z.number(),
  updatedAt: z.number()
})

const fileSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  items: z.array(itemSchema)
})

export interface PromptLibraryFile {
  version: number
  items: PromptLibraryItem[]
}

/** 保存失败时抛出，IPC 层会把它转成界面能看懂的提示 */
export class PromptLibraryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PromptLibraryError'
  }
}

const FILE = (): string => join(app.getPath('userData'), 'prompt-library.json')

let cache: PromptLibraryFile | null = null
/** 写操作的串行队列 */
let writeChain: Promise<unknown> = Promise.resolve()

/** 只用于测试：清掉内存缓存和队列 */
export function resetPromptLibraryCacheForTest(): void {
  cache = null
  writeChain = Promise.resolve()
}

function readFile(): PromptLibraryFile {
  const file = FILE()
  if (!existsSync(file)) return { version: SCHEMA_VERSION, items: [] }

  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    throw new PromptLibraryError(mainT('promptLibrary.errorCorrupt'))
  }

  const version = (json as { version?: unknown } | null)?.version
  if (version !== SCHEMA_VERSION) {
    throw new PromptLibraryError(
      mainT('promptLibrary.errorVersion', { version: String(version) })
    )
  }

  const parsed = fileSchema.safeParse(json)
  if (!parsed.success) {
    throw new PromptLibraryError(mainT('promptLibrary.errorSchema'))
  }
  return parsed.data as PromptLibraryFile
}

/**
 * 读取库。每次写操作前都会重新读盘，避免用旧缓存覆盖别处刚写进去的内容。
 * 读取失败（文件损坏）时抛出，由调用方显示错误 —— 不返回空库。
 */
export function loadPromptLibrary(): PromptLibraryFile {
  if (cache) return cache
  cache = readFile()
  return cache
}

/**
 * 原子写入。成功之后才更新缓存；失败抛出 PromptLibraryError。
 *
 * 注意这里**不**像 stylesStore 那样吞掉错误：用户点了保存就必须知道
 * 到底有没有存进去。
 */
function persist(next: PromptLibraryFile): PromptLibraryFile {
  const file = FILE()
  const temp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, JSON.stringify(next, null, 2), 'utf-8')
    renameSync(temp, file)
  } catch (error) {
    log(`保存 Prompt 库失败: ${String(error)}`)
    throw new PromptLibraryError(mainT('promptLibrary.errorSave'))
  }
  cache = next
  return next
}

/** 串行执行写操作。队列本身不会因为某次失败而中断。 */
function enqueue<T>(task: () => T): Promise<T> {
  const run = writeChain.then(task, task)
  writeChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** 校验 id：只接受简单的可见字符 */
function assertId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new PromptLibraryError(mainT('promptLibrary.errorId'))
  }
}

/** 校验标题与正文的上限。超限明确报错，**不截断**保存。 */
function assertLimits(title: string, content: string): void {
  if (Array.from(title).length > PROMPT_TITLE_MAX) {
    throw new PromptLibraryError(
      mainT('promptLibrary.errorTitleTooLong', { max: PROMPT_TITLE_MAX })
    )
  }
  if (content.trim() === '') {
    throw new PromptLibraryError(mainT('promptLibrary.errorContentEmpty'))
  }
  if (Array.from(content).length > PROMPT_CONTENT_MAX) {
    throw new PromptLibraryError(
      mainT('promptLibrary.errorContentTooLong', { max: PROMPT_CONTENT_MAX })
    )
  }
}

export interface SavePromptInput {
  id: string
  title: string
  content: string
  titleSource: 'user' | 'ai' | 'none'
}

function saveSync(input: SavePromptInput): PromptLibraryFile {
  assertId(input.id)
  if (typeof input.title !== 'string' || typeof input.content !== 'string') {
    throw new PromptLibraryError(mainT('promptLibrary.errorFields'))
  }

  const title = normalizePromptTitle(input.title)
  const content = input.content
  assertLimits(title, content)

  // 空标题统一记为 none；手填的是 user；AI 回填的是 ai
  const titleSource: 'user' | 'ai' | 'none' =
    input.title.trim() === '' ? 'none' : input.titleSource

  cache = null
  const data = loadPromptLibrary()
  const now = Date.now()
  const existing = data.items.find((item) => item.id === input.id)

  const item: PromptLibraryItem = existing
    ? { ...existing, title, content, titleSource, updatedAt: now }
    : { id: input.id, title, content, titleSource, createdAt: now, updatedAt: now }

  const items = existing
    ? data.items.map((i) => (i.id === input.id ? item : i))
    : [...data.items, item]

  return persist({ version: SCHEMA_VERSION, items })
}

/** 新建或更新一条。写操作串行执行。 */
export function savePromptItem(input: SavePromptInput): Promise<PromptLibraryFile> {
  return enqueue(() => saveSync(input))
}

/** 删除一条。不存在时也返回成功（幂等）。 */
export function deletePromptItem(id: unknown): Promise<PromptLibraryFile> {
  return enqueue(() => {
    assertId(id)
    cache = null
    const data = loadPromptLibrary()
    const items = data.items.filter((item) => item.id !== id)
    if (items.length === data.items.length) return data
    return persist({ version: SCHEMA_VERSION, items })
  })
}

/** 读取库。损坏时抛出，界面据此提示用户而不是显示空库。 */
export function listPromptItems(): PromptLibraryFile {
  return loadPromptLibrary()
}
