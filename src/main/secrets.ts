import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { log } from './logger'

/**
 * API Key 的加密存储。
 *
 * 【硬性要求】
 * - 用 Electron 的 safeStorage 加密后保存
 * - 明文绝不返回给界面进程，界面只能问"有没有设置"
 * - 明文绝不写进日志
 */

interface SecretsFile {
  /** 配置 id → 加密后的 base64 */
  [profileId: string]: string
}

const FILE = () => join(app.getPath('userData'), 'secrets.bin')

let cache: SecretsFile | null = null

function load(): SecretsFile {
  if (cache) return cache

  const file = FILE()
  if (!existsSync(file)) {
    cache = {}
    return cache
  }

  try {
    const raw = readFileSync(file, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      cache = {}
      return cache
    }
    cache = parsed as SecretsFile
    return cache
  } catch {
    log('密钥文件解析失败，按空处理')
    cache = {}
    return cache
  }
}

function persist(data: SecretsFile): void {
  cache = data
  const file = FILE()
  const temp = `${file}.tmp`
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(temp, JSON.stringify(data), 'utf-8')
    renameSync(temp, file)
  } catch (error) {
    log(`保存密钥失败: ${String(error)}`)
  }
}

/** 加密保存一个 Key */
export function setSecret(profileId: string, plainKey: string): boolean {
  if (!plainKey) {
    return removeSecret(profileId)
  }

  if (!safeStorage.isEncryptionAvailable()) {
    // 系统不支持加密时，拒绝保存，避免明文落盘
    log('系统不支持加密存储，拒绝保存 API Key')
    return false
  }

  try {
    const encrypted = safeStorage.encryptString(plainKey)
    const data = { ...load(), [profileId]: encrypted.toString('base64') }
    persist(data)
    return true
  } catch (error) {
    log(`加密保存失败: ${String(error)}`)
    return false
  }
}

/** 读取解密后的 Key。只在主进程内部使用，绝不通过 IPC 返回。 */
export function getSecret(profileId: string): string | null {
  const data = load()
  const stored = data[profileId]
  if (!stored) return null

  if (!safeStorage.isEncryptionAvailable()) {
    log('系统不支持解密，无法读取 API Key')
    return null
  }

  try {
    const buffer = Buffer.from(stored, 'base64')
    return safeStorage.decryptString(buffer)
  } catch (error) {
    log(`解密失败（配置 ${profileId}）: ${String(error)}`)
    return null
  }
}

/** 查询是否已经设置过 Key。界面只能拿到这个。 */
export function hasSecret(profileId: string): boolean {
  return Boolean(load()[profileId])
}

export function removeSecret(profileId: string): boolean {
  const data = { ...load() }
  delete data[profileId]
  persist(data)
  return true
}
