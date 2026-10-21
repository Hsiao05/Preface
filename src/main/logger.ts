import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

/**
 * 简单日志。写到 userData/logs/preface.log，同时输出到控制台。
 * 注意：绝不能把 API Key 写进来。需要记录 Key 相关操作时，一律打码。
 */
const LOG_FILE = () => join(app.getPath('userData'), 'logs', 'preface.log')

/**
 * 基础运行日志始终写入文件（不含任何请求内容）。
 * "调试日志"开关控制的是请求内容的记录，见 setContentLoggingEnabled。
 */
let contentLogging = false

export function setContentLoggingEnabled(value: boolean): void {
  contentLogging = value
}

export function isContentLoggingEnabled(): boolean {
  return contentLogging
}

export function log(message: string): void {
  const line = `${new Date().toISOString()} ${message}`
  try {
    const file = LOG_FILE()
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, line + '\n', 'utf-8')
  } catch {
    // 日志写入失败不影响程序运行
  }
  console.log(message)
}

/** 记录请求内容。只有打开"调试日志"时才会写盘。调用前必须自行把 Key 打码。 */
export function logContent(message: string): void {
  if (!contentLogging) return
  log(`[请求内容] ${message}`)
}

export function logError(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error ?? '')
  log(`[错误] ${message}${detail ? '\n' + detail : ''}`)
}

/** 把 Key 打码，只留前 4 位和后 4 位 */
export function maskKey(key: string): string {
  if (!key) return '(empty)'
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

export function getLogFilePath(): string {
  return LOG_FILE()
}
