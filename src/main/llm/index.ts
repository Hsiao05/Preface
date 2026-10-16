import { BrowserWindow } from 'electron'
import { log, logContent, maskKey } from '../logger'
import { getCurrentProfile, getProfile, markPrivacyNoticeShown, type ModelProfile } from '../profiles'
import { getSecret } from '../secrets'
import { LlmRequestError, listModels, runChat, testConnection, type ChatMessage } from './client'
import { estimateTokens } from '../../shared/estimateTokens'
import { describeNetworkError, type LlmError } from '../../shared/llmErrors'
import type { UsageInfo } from '../../shared/sse'

/**
 * 调用的种类与参数（文档第五节的表）。
 */
export type CallKind = 'optimize' | 'followup' | 'tidy' | 'title'

/** 每种调用的 max_tokens 与默认超时 */
export const CALL_SPECS: Record<
  CallKind,
  { stream: boolean; maxTokens: number; timeoutMs: number }
> = {
  optimize: { stream: true, maxTokens: 3000, timeoutMs: 120000 },
  followup: { stream: true, maxTokens: 3000, timeoutMs: 120000 },
  tidy: { stream: true, maxTokens: 4000, timeoutMs: 120000 },
  title: { stream: false, maxTokens: 50, timeoutMs: 30000 }
}

/** tidy 的 max_tokens 按原文估算的 2 倍，最少 500，最多 4000 */
export function tidyMaxTokens(sourceText: string): number {
  const estimate = estimateTokens(sourceText) * 2
  return Math.max(500, Math.min(4000, estimate))
}

// ---------- 进行中的请求 ----------

interface PendingRequest {
  controller: AbortController
  kind: CallKind
  /** 事件发到这个频道 */
  channel: string
}

const pending = new Map<string, PendingRequest>()

let nextRequestId = 1

/** 取消一个正在进行的请求 */
export function cancelRequest(requestId: string): boolean {
  const request = pending.get(requestId)
  if (!request) return false
  request.controller.abort()
  pending.delete(requestId)
  log(`已取消请求 ${requestId}（${request.kind}）`)
  return true
}

/** 取消全部进行中的请求（程序退出时用） */
export function cancelAllRequests(): void {
  for (const [id, request] of pending) {
    request.controller.abort()
    pending.delete(id)
  }
}

// ---------- 事件发送 ----------

interface StreamEvent {
  type: 'delta' | 'usage' | 'reasoning' | 'privacy-notice' | 'done' | 'error'
  text?: string
  usage?: UsageInfo
  error?: LlmError
  /** 这次调用里模型输出了思考内容 */
  sawReasoning?: boolean
  /** 输出被 max_tokens 上限截断了 */
  truncated?: boolean
  /** 推理过程用掉的 token 数 */
  reasoningTokens?: number
}

function send(channel: string, event: StreamEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, event)
    }
  }
}

// ---------- 主入口 ----------

export interface RunInput {
  kind: CallKind
  messages: ChatMessage[]
  /** tidy 调用用原文长度决定 max_tokens */
  sourceText?: string
  /** 用哪套配置，不传则用当前配置 */
  profileId?: string
}

export interface StartResult {
  requestId: string
}

/**
 * 发起一次模型调用。立即返回 requestId，结果通过 channel 推送。
 */
export async function startRun(input: RunInput, channel: string): Promise<StartResult> {
  const requestId = `req_${nextRequestId++}`

  const profile = input.profileId ? getProfile(input.profileId) : getCurrentProfile()

  if (!profile) {
    send(channel, {
      type: 'error',
      error: {
        message: '还没有配置模型',
        suggestion: '请到设置里添加一套模型配置，填入 Base URL 和 API Key。'
      }
    })
    return { requestId }
  }

  const apiKey = getSecret(profile.id)
  if (!apiKey) {
    send(channel, {
      type: 'error',
      error: {
        message: '这套配置还没有填 API Key',
        suggestion: '请到设置里为这套配置填入 API Key。'
      }
    })
    return { requestId }
  }

  const spec = CALL_SPECS[input.kind]
  const maxTokens =
    input.kind === 'tidy' && input.sourceText
      ? tidyMaxTokens(input.sourceText)
      : spec.maxTokens

  const controller = new AbortController()
  pending.set(requestId, { controller, kind: input.kind, channel })

  log(`发起调用 ${requestId}（${input.kind}，模型 ${profile.model}，Key ${maskKey(apiKey)}）`)
  logContent(
    `${input.kind} 请求消息：\n` +
      input.messages.map((m) => `[${m.role}] ${m.content}`).join('\n---\n')
  )

  // 第一次用这套配置时，提示一次隐私说明
  if (!profile.privacyNoticeShown) {
    markPrivacyNoticeShown(profile.id)
    send(channel, { type: 'privacy-notice' })
  }

  // 异步执行，不阻塞 IPC 返回
  void execute({
    requestId,
    channel,
    profile,
    apiKey,
    messages: input.messages,
    stream: spec.stream,
    maxTokens,
    timeoutMs: spec.timeoutMs,
    signal: controller.signal
  })

  return { requestId }
}

interface ExecuteInput {
  requestId: string
  channel: string
  profile: ModelProfile
  apiKey: string
  messages: ChatMessage[]
  stream: boolean
  maxTokens: number
  timeoutMs: number
  signal: AbortSignal
}

async function execute(input: ExecuteInput): Promise<void> {
  const { requestId, channel, signal } = input

  try {
    const result = await runChat({
      profile: { ...input.profile, timeoutMs: input.timeoutMs },
      apiKey: input.apiKey,
      messages: input.messages,
      stream: input.stream,
      maxTokens: input.maxTokens,
      signal,
      onDelta: (text) => send(channel, { type: 'delta', text }),
      onUsage: (usage) => send(channel, { type: 'usage', usage }),
      onReasoning: () => send(channel, { type: 'reasoning' })
    })

    send(channel, {
      type: 'done',
      text: result.text,
      usage: result.usage ?? undefined,
      sawReasoning: result.sawReasoning,
      truncated: result.truncated,
      reasoningTokens: result.reasoningTokens
    })
    log(
      `调用 ${requestId} 完成，输出 ${result.text.length} 字` +
        (result.sawReasoning ? '（模型带了推理过程）' : '')
    )
  } catch (error) {
    const info =
      error instanceof LlmRequestError ? error.info : describeNetworkError(error)
    send(channel, { type: 'error', error: info })
    log(`调用 ${requestId} 失败：${info.message}`)
  } finally {
    pending.delete(requestId)
  }
}

// ---------- 供 IPC 直接调用的几个 ----------

export async function doListModels(
  profileId?: string
): Promise<{ ok: true; models: Array<{ id: string; displayName?: string }> } | { ok: false; error: LlmError }> {
  const profile = profileId ? getProfile(profileId) : getCurrentProfile()
  if (!profile) {
    return {
      ok: false,
      error: {
        message: '还没有配置模型',
        suggestion: '请先添加一套模型配置。'
      }
    }
  }

  const apiKey = getSecret(profile.id)
  if (!apiKey) {
    return {
      ok: false,
      error: { message: '还没有填 API Key', suggestion: '请先填入 API Key。' }
    }
  }

  try {
    const models = await listModels(profile, apiKey)
    return { ok: true, models }
  } catch (error) {
    if (error instanceof LlmRequestError) {
      return { ok: false, error: error.info }
    }
    return { ok: false, error: describeNetworkError(error) }
  }
}

export async function doTestConnection(
  profileId?: string
): Promise<{ ok: true; elapsedMs: number } | { ok: false; error: LlmError }> {
  const profile = profileId ? getProfile(profileId) : getCurrentProfile()
  if (!profile) {
    return { ok: false, error: { message: '还没有配置模型', suggestion: '请先添加一套模型配置。' } }
  }

  const apiKey = getSecret(profile.id)
  if (!apiKey) {
    return { ok: false, error: { message: '还没有填 API Key', suggestion: '请先填入 API Key。' } }
  }

  return testConnection(profile, apiKey)
}
