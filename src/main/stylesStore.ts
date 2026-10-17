import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { z } from 'zod'
import { log } from './logger'
import { BUILTIN_BLOCKS, BLOCK_META, type BlockId } from '../shared/prompts/blocks'
import { BUILTIN_TEMPLATES, TEMPLATE_META, type TemplateId } from '../shared/prompts/templates'
import { BUILTIN_STYLES, MY_STYLE_ID } from '../shared/prompts/styles'

/**
 * 提示词与风格的存储（文档第八节）。
 *
 * 三类内容：
 * - 块（block）：优化系统提示词的组成部分
 * - 模板（template）：整理碎碎念、语料标题
 * - 风格（style）：表达风格，只有它带 samples
 *
 * 每一项都记 builtinVersion 和 edited，用于内置版本升级时判断该不该覆盖。
 */

/** 每个内置项的版本号。改了内置内容就把对应数字加一。 */
export const BUILTIN_VERSIONS = {
  // 块
  role: 1,
  rules: 3, // 2 加过"用词检查"；3 加过"保留命令"
  simple: 2, // 加过"保留 /命令"
  markdown: 2, // 加过"保留 /命令"
  // 模板
  tidy: 2, // 加过"保留 /命令"
  title: 1,
  // 风格
  'clear-direct': 1,
  rigorous: 1,
  concise: 1,
  detailed: 1,
  collaborative: 1,
  'my-style': 1
} as const

export const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(['block', 'template', 'style', 'extra']),
  name: z.string(),
  builtin: z.boolean(),
  builtinVersion: z.number().int().min(0),
  edited: z.boolean(),
  text: z.string(),
  /** 只有 style 才有 */
  samples: z.array(z.string()).optional()
})

export type StyleItem = z.infer<typeof itemSchema>

const stylesFileSchema = z.object({
  items: z.array(itemSchema)
})

export type StylesFile = z.infer<typeof stylesFileSchema>

const FILE = () => join(app.getPath('userData'), 'styles.json')

/** 取某项的内置版本号 */
function builtinVersionOf(id: string): number {
  return (BUILTIN_VERSIONS as Record<string, number>)[id] ?? 1
}

/** 生成一份完整的内置默认值 */
export function defaultItems(): StyleItem[] {
  const items: StyleItem[] = []

  // 块
  for (const meta of BLOCK_META) {
    items.push({
      id: meta.id,
      kind: 'block',
      name: meta.name,
      builtin: true,
      builtinVersion: builtinVersionOf(meta.id),
      edited: false,
      text: BUILTIN_BLOCKS[meta.id as BlockId]
    })
  }

  // 模板
  for (const meta of TEMPLATE_META) {
    items.push({
      id: meta.id,
      kind: 'template',
      name: meta.name,
      builtin: true,
      builtinVersion: builtinVersionOf(meta.id),
      edited: false,
      text: BUILTIN_TEMPLATES[meta.id as TemplateId]
    })
  }

  // 风格
  for (const style of BUILTIN_STYLES) {
    items.push({
      id: style.id,
      kind: 'style',
      name: style.name,
      builtin: true,
      builtinVersion: builtinVersionOf(style.id),
      edited: false,
      text: style.text,
      samples: []
    })
  }

  // 我的附加要求
  items.push({
    id: 'extra',
    kind: 'extra',
    name: '我的附加要求',
    builtin: true,
    builtinVersion: 1,
    edited: false,
    text: ''
  })

  return items
}

/** 取某项的内置默认文本 */
export function builtinTextOf(item: StyleItem): string | null {
  if (item.kind === 'block') {
    return BUILTIN_BLOCKS[item.id as BlockId] ?? null
  }
  if (item.kind === 'template') {
    return BUILTIN_TEMPLATES[item.id as TemplateId] ?? null
  }
  if (item.kind === 'style') {
    return BUILTIN_STYLES.find((s) => s.id === item.id)?.text ?? null
  }
  if (item.kind === 'extra') {
    return '' // 附加要求默认是空的
  }
  return null
}

/**
 * 把内置项的版本升级应用到用户数据上。
 *
 * 规则（文档第八节）：
 * - 用户没改过（edited 为 false）的，直接替换为新版
 * - 用户改过的，保留用户的文本和原来的版本号，设置页持续显示"有更新"，
 *   直到用户点「替换为新版」
 *
 * 【为什么改过的项不能更新版本号】
 * hasBuiltinUpdate() 的判断是 builtinVersion < 当前版本。如果这里把版本号
 * 也一起更新了，改过的项就永远不会显示"有更新"——用户既没拿到新内容，
 * 界面也不提示，等于升级悄悄丢了。所以这里必须保留旧版本号。
 */
export function applyBuiltinUpgrades(items: StyleItem[]): {
  items: StyleItem[]
  changed: boolean
} {
  let changed = false

  const next = items.map((item) => {
    if (!item.builtin) return item

    const currentVersion = builtinVersionOf(item.id)
    if (item.builtinVersion >= currentVersion) return item

    // 改过的：原样保留，什么都不做（版本号也不动）
    if (item.edited) return item

    // 没改过：直接用新版
    const text = builtinTextOf(item)
    if (text === null) return item
    changed = true
    return { ...item, text, builtinVersion: currentVersion, edited: false }
  })

  return { items: next, changed }
}

/** 补齐缺失的内置项（例如软件更新后新增了某个内置风格） */
function ensureBuiltinsExist(items: StyleItem[]): { items: StyleItem[]; changed: boolean } {
  const existing = new Set(items.map((i) => i.id))
  const defaults = defaultItems()
  const missing = defaults.filter((d) => !existing.has(d.id))

  if (missing.length === 0) return { items, changed: false }
  return { items: [...items, ...missing], changed: true }
}

let cache: StylesFile | null = null

export function loadStyles(): StylesFile {
  if (cache) return cache

  const file = FILE()
  if (!existsSync(file)) {
    cache = { items: defaultItems() }
    return cache
  }

  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    const parsed = stylesFileSchema.safeParse(raw)

    if (!parsed.success) {
      log('提示词配置文件校验失败，已备份并重置')
      backup(file)
      cache = { items: defaultItems() }
      return cache
    }

    // 补齐缺失的内置项，并应用版本升级
    let items = parsed.data.items
    const ensured = ensureBuiltinsExist(items)
    items = ensured.items
    const upgraded = applyBuiltinUpgrades(items)
    items = upgraded.items

    // 有变化就立刻存回去
    if (ensured.changed || upgraded.changed) {
      cache = { items }
      persist(cache)
      return cache
    }

    cache = { items }
    return cache
  } catch {
    log('提示词配置文件解析失败，已备份并重置')
    backup(file)
    cache = { items: defaultItems() }
    return cache
  }
}

function backup(file: string): void {
  try {
    copyFileSync(file, `${file}.bak`)
  } catch {
    // 忽略
  }
}

function persist(data: StylesFile): void {
  cache = data
  const file = FILE()
  const temp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(temp, file)
  } catch (error) {
    log(`保存提示词配置失败: ${String(error)}`)
  }
}

/** 保存某一项 */
export function saveItem(item: StyleItem): StylesFile {
  const data = loadStyles()
  const index = data.items.findIndex((i) => i.id === item.id)

  const items = [...data.items]
  if (index >= 0) {
    // 内置项被改了就把 edited 标记上
    const isBuiltin = items[index].builtin
    const builtinText = builtinTextOf(items[index])
    const edited = isBuiltin ? item.text !== builtinText : false

    items[index] = {
      ...item,
      builtin: isBuiltin,
      edited,
      // 保留原有的版本号，除非是新项
      builtinVersion: items[index].builtinVersion
    }
  } else {
    items.push({ ...item, builtin: false, builtinVersion: 0, edited: false })
  }

  const next = { items }
  persist(next)
  return next
}

/** 恢复某一项为内置默认值 */
export function resetItem(id: string): StylesFile {
  const data = loadStyles()
  const items = data.items.map((item) => {
    if (item.id !== id || !item.builtin) return item

    const text = builtinTextOf(item)
    if (text === null) return item

    return {
      ...item,
      text,
      edited: false,
      builtinVersion: builtinVersionOf(item.id),
      // 风格的样本也清掉
      samples: item.kind === 'style' ? [] : item.samples
    }
  })

  const next = { items }
  persist(next)
  return next
}

/** 删除一项（只能删用户新建的风格） */
export function deleteItem(id: string): { ok: boolean; styles: StylesFile } {
  const data = loadStyles()
  const item = data.items.find((i) => i.id === id)

  // 内置项不能删
  if (!item || item.builtin) {
    return { ok: false, styles: data }
  }

  const next = { items: data.items.filter((i) => i.id !== id) }
  persist(next)
  return { ok: true, styles: next }
}

/** 复制为新的风格 */
export function duplicateStyle(id: string, newId: string, newName: string): StylesFile {
  const data = loadStyles()
  const source = data.items.find((i) => i.id === id)

  if (!source || source.kind !== 'style') {
    return data
  }

  const copy: StyleItem = {
    id: newId,
    kind: 'style',
    name: newName,
    builtin: false,
    builtinVersion: 0,
    edited: false,
    text: source.text,
    samples: [...(source.samples ?? [])]
  }

  const next = { items: [...data.items, copy] }
  persist(next)
  return next
}

/** 整体替换（导入用） */
export function replaceAll(items: StyleItem[]): StylesFile {
  // 校验一遍再存
  const parsed = stylesFileSchema.safeParse({ items })
  const safe = parsed.success ? parsed.data : { items: defaultItems() }

  // 补齐缺失的内置项
  const ensured = ensureBuiltinsExist(safe.items)
  const next = { items: ensured.items }
  persist(next)
  return next
}

/** 导出成 JSON 字符串 */
export function exportStyles(): string {
  const data = loadStyles()
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      items: data.items
    },
    null,
    2
  )
}

/** 从 JSON 导入。返回冲突的 id 列表，供界面询问覆盖还是另存。 */
export function importStyles(json: string): {
  ok: boolean
  conflicts: Array<{ id: string; name: string }>
  items: StyleItem[]
  error?: string
} {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, conflicts: [], items: [], error: '文件不是合法的 JSON' }
  }

  const obj = parsed as Record<string, unknown>
  const rawItems = Array.isArray(obj?.items) ? obj.items : null

  if (!rawItems) {
    return { ok: false, conflicts: [], items: [], error: '文件里没有找到提示词数据' }
  }

  const validated = z.array(itemSchema).safeParse(rawItems)
  if (!validated.success) {
    return { ok: false, conflicts: [], items: [], error: '文件内容格式不对' }
  }

  // 找出和现有项冲突的 id（内置项不算冲突，因为要按 id 匹配）
  const existing = loadStyles().items
  const existingIds = new Set(existing.map((i) => i.id))
  const conflicts = validated.data
    .filter((i) => existingIds.has(i.id))
    .map((i) => ({ id: i.id, name: i.name }))

  return { ok: true, conflicts, items: validated.data }
}

/** 检查是否有内置项的版本落后了（设置页要显示"内置版本有更新"） */
export function hasBuiltinUpdate(item: StyleItem): boolean {
  if (!item.builtin) return false
  return item.builtinVersion < builtinVersionOf(item.id)
}

/** "我的风格"有没有样本 —— 没有时下拉框里不可选 */
export function hasMyStyleSamples(): boolean {
  const item = loadStyles().items.find((i) => i.id === MY_STYLE_ID)
  return Boolean(item?.samples && item.samples.length > 0)
}

export { MY_STYLE_ID }
