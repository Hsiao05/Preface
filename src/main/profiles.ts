import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { z } from 'zod'
import { log } from './logger'

/**
 * 模型配置。可以保存多套，选一套作为当前配置。
 * API Key 不在这里，它由 secrets.ts 单独加密保存。
 */

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: z.enum(['openai', 'anthropic']),
  baseUrl: z.string(),
  model: z.string(),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().min(1).default(4096),
  timeoutMs: z.number().int().min(1000).default(120000),
  /** 已经提示过"内容会发送给该服务商" */
  privacyNoticeShown: z.boolean().default(false)
})

export type ModelProfile = z.infer<typeof profileSchema>

export function defaultProfile(id: string, name: string): ModelProfile {
  return {
    id,
    name,
    format: 'openai',
    baseUrl: '',
    model: '',
    temperature: 0.3,
    maxTokens: 4096,
    timeoutMs: 120000,
    privacyNoticeShown: false
  }
}

const FILE = () => join(app.getPath('userData'), 'profiles.json')

const profilesFileSchema = z.object({
  profiles: z.array(profileSchema),
  currentId: z.string().nullable()
})

export type ProfilesFile = z.infer<typeof profilesFileSchema>

let cache: ProfilesFile | null = null

export function loadProfiles(): ProfilesFile {
  if (cache) return cache

  const file = FILE()
  if (!existsSync(file)) {
    cache = { profiles: [], currentId: null }
    return cache
  }

  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8'))
    const parsed = profilesFileSchema.safeParse(raw)
    if (!parsed.success) {
      log('模型配置文件校验失败，已备份并重置')
      try {
        copyFileSync(file, `${file}.bak`)
      } catch {
        // 备份失败不影响启动
      }
      cache = { profiles: [], currentId: null }
      return cache
    }
    cache = parsed.data
    return cache
  } catch {
    log('模型配置文件解析失败，已备份并重置')
    try {
      copyFileSync(file, `${file}.bak`)
    } catch {
      // 忽略
    }
    cache = { profiles: [], currentId: null }
    return cache
  }
}

function persist(data: ProfilesFile): void {
  cache = data
  const file = FILE()
  const temp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(temp, file)
  } catch (error) {
    log(`保存模型配置失败: ${String(error)}`)
  }
}

export function saveProfile(profile: ModelProfile): ProfilesFile {
  const data = loadProfiles()
  const index = data.profiles.findIndex((p) => p.id === profile.id)
  const profiles = [...data.profiles]

  if (index >= 0) {
    profiles[index] = profile
  } else {
    profiles.push(profile)
  }

  const next: ProfilesFile = {
    profiles,
    currentId: data.currentId ?? profile.id
  }
  persist(next)
  return next
}

export function deleteProfile(id: string): ProfilesFile {
  const data = loadProfiles()
  const profiles = data.profiles.filter((p) => p.id !== id)
  const currentId = data.currentId === id ? (profiles[0]?.id ?? null) : data.currentId
  const next: ProfilesFile = { profiles, currentId }
  persist(next)
  return next
}

export function setCurrentProfile(id: string | null): ProfilesFile {
  const data = loadProfiles()
  const next: ProfilesFile = { profiles: data.profiles, currentId: id }
  persist(next)
  return next
}

/** 取当前配置。没有配置时返回 null。 */
export function getCurrentProfile(): ModelProfile | null {
  const data = loadProfiles()
  if (!data.currentId) return null
  return data.profiles.find((p) => p.id === data.currentId) ?? null
}

export function getProfile(id: string): ModelProfile | null {
  return loadProfiles().profiles.find((p) => p.id === id) ?? null
}

/** 标记已经显示过隐私提示 */
export function markPrivacyNoticeShown(id: string): void {
  const profile = getProfile(id)
  if (!profile || profile.privacyNoticeShown) return
  saveProfile({ ...profile, privacyNoticeShown: true })
}
