import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { z } from 'zod'
import { log } from './logger'

/**
 * 语音输入的设置。
 *
 * 单独定义再嵌进去，这样嵌套对象也能拿到各字段的默认值
 * （zod 的 .default({}) 不会自动填充内部字段）。
 */
export const speechSettingsSchema = z.object({
  /** 服务商预设 id */
  preset: z.string().default('siliconflow'),
  baseUrl: z.string().default('https://api.siliconflow.cn/v1'),
  model: z.string().default('FunAudioLLM/SenseVoiceSmall'),
  apiType: z.enum(['transcriptions', 'chat-audio']).default('transcriptions'),
  language: z.enum(['auto', 'zh', 'en']).default('auto'),
  /** 最长录音时长（秒） */
  maxSeconds: z.number().int().min(5).max(1800).default(300)
})

export type SpeechSettings = z.infer<typeof speechSettingsSchema>

/** 全部设置项。新增设置项时，在这里加上字段和默认值即可。 */
export const settingsSchema = z.object({
  // 通用
  shortcut: z.string().default('CommandOrControl+Alt+X'),
  autoLaunch: z.boolean().default(false),
  alwaysOnTop: z.boolean().default(false),
  /** 深浅色模式：跟随设备 / 浅色 / 深色 */
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  /** 界面缩放比例。1 表示 100%。范围 0.7 到 1.5。 */
  zoom: z.number().min(0.7).max(1.5).default(1),
  /** 界面语言：中文 / English */
  uiLanguage: z.enum(['zh', 'en']).default('zh'),
  /** 翻译目标：预设语言 id，或用户自己输入的语言名 */
  translationTarget: z.string().max(60).default('en'),

  // 默认值
  defaultTarget: z.enum(['local', 'web']).default('local'),
  defaultMode: z.enum(['auto', 'simple', 'markdown']).default('auto'),
  defaultStyleId: z.string().default('clear-direct'),
  defaultReplyFormat: z.enum(['none', 'markdown', 'plain']).default('none'),

  // 模型
  currentProfileId: z.string().nullable().default(null),

  // 优化
  corpusInfo: z.enum(['title', 'excerpt300', 'full']).default('title'),
  maxQuestions: z.number().int().min(0).max(5).default(3),
  tidyUseStyleSamples: z.boolean().default(false),
  showTokenUsage: z.boolean().default(true),

  // 复制
  lengthWarnThreshold: z.number().int().min(0).default(60000),
  copyToWorkDir: z.boolean().default(false),
  workDir: z.string().default(''),

  // 草稿历史
  // 快照保留时长（分钟）。0 表示永不删除。
  snapshotRetentionMinutes: z.number().int().min(0).default(1440),

  // 语音输入
  speech: speechSettingsSchema.default(() => speechSettingsSchema.parse({})),

  // 高级
  debugLog: z.boolean().default(false),
  keepRecentSends: z.boolean().default(false)
})

export type Settings = z.infer<typeof settingsSchema>

/** 用 schema 的默认值构造一份完整设置 */
export function defaultSettings(): Settings {
  return settingsSchema.parse({})
}

/**
 * 老版本设置的一次性迁移。
 *
 * 【为什么需要】
 * 默认快捷键从 Ctrl+Alt+K 换成了 Ctrl+Alt+X（X 取自「序」的声母 xù）。
 * 但老用户的 settings.json 里存着 K，会盖住新默认值，导致换了等于没换。
 *
 * 这里只在"存的正好是那个旧默认值"时才替换 —— 如果用户自己改过
 * 别的键，说明那是他的选择，不能动。
 */
const SHORTCUT_MIGRATIONS: Array<{ from: string; to: string }> = [
  // 曾经自动回退到 K 的那批用户
  { from: 'CommandOrControl+Alt+K', to: 'CommandOrControl+Alt+X' }
]

function migrate(settings: Settings): Settings {
  let result = settings

  for (const { from, to } of SHORTCUT_MIGRATIONS) {
    if (result.shortcut !== from) continue
    result = { ...result, shortcut: to }
    log(`快捷键迁移：${from} → ${to}`)
  }

  return result
}

const FILE = () => join(app.getPath('userData'), 'settings.json')

let cache: Settings | null = null

export function loadSettings(): Settings {
  if (cache) return cache

  const file = FILE()
  if (!existsSync(file)) {
    cache = defaultSettings()
    return cache
  }

  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    // 缺字段用默认值补齐，多余字段忽略，类型不对则退回默认值
    const parsed = settingsSchema.safeParse(raw)
    if (!parsed.success) {
      backupCorrupted(file)
      cache = defaultSettings()
      return cache
    }
    const migrated = migrate(parsed.data)
    // 迁移过就立刻写回，免得每次启动都迁一遍
    if (migrated !== parsed.data) writeFile(migrated)
    cache = migrated
    return cache
  } catch (error) {
    log('设置文件解析失败，已备份并恢复默认值')
    backupCorrupted(file)
    cache = defaultSettings()
    return cache
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = loadSettings()
  const merged = settingsSchema.parse({ ...current, ...patch })
  cache = merged
  writeFile(merged)
  return merged
}

/**
 * 落盘。先写临时文件再改名，避免中途崩溃留下半个文件。
 *
 * 单独抽出来是因为 loadSettings 里的迁移也要用它 —— 走 saveSettings 的话
 * 会回头去调 loadSettings，而那时 cache 还没赋值，会无限递归。
 */
function writeFile(settings: Settings): void {
  const file = FILE()
  const temp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf-8')
    renameSync(temp, file)
  } catch (error) {
    log(`保存设置失败: ${String(error)}`)
  }
}

/** 文件损坏时重命名为 .bak，保留现场供排查 */
function backupCorrupted(file: string): void {
  try {
    copyFileSync(file, `${file}.bak`)
  } catch {
    // 备份失败也不影响启动
  }
}
