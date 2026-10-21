/**
 * 把各种失败情况翻译成用户能看懂的说明和建议。
 * 文档第五节：模型请求出错时，要说明原因和建议，不能只显示英文报错。
 */

import { translate, type MessageKey, type UiLanguage } from './i18n'

export interface LlmError {
  /** 简短的原因 */
  message: string
  /** 下一步该怎么做 */
  suggestion?: string
  /** HTTP 状态码，没有则为 undefined */
  status?: number
}

function t(
  language: UiLanguage,
  key: MessageKey,
  params?: Record<string, string | number>
): string {
  return translate(language, key, params)
}

export function describeHttpError(
  status: number,
  body?: string,
  language: UiLanguage = 'zh'
): LlmError {
  // 服务商返回的错误正文里可能有关键信息，但不要整段展示
  const detail = extractDetail(body)

  switch (true) {
    case status === 401 || status === 403:
      return {
        message: t(language, 'error.http401'),
        suggestion: t(language, 'error.http401Hint'),
        status
      }

    case status === 404:
      return {
        message: t(language, 'error.http404'),
        suggestion: t(language, 'error.http404Hint'),
        status
      }

    case status === 429:
      return {
        message: t(language, 'error.http429'),
        suggestion: t(language, 'error.http429Hint'),
        status
      }

    case status === 400:
      return {
        message: detail
          ? t(language, 'error.rejected', { detail })
          : t(language, 'error.badRequest'),
        suggestion: t(language, 'error.badRequestHint'),
        status
      }

    case status >= 500:
      return {
        message: t(language, 'error.server'),
        suggestion: t(language, 'error.serverHint'),
        status
      }

    default:
      return {
        message: detail
          ? t(language, 'error.httpOther', { status, detail })
          : t(language, 'error.httpOtherNoDetail', { status }),
        suggestion: t(language, 'error.httpOtherHint'),
        status
      }
  }
}

/** 从错误正文里提取一句简短说明 */
function extractDetail(body?: string): string {
  if (!body) return ''
  try {
    const json = JSON.parse(body)
    const error = json?.error
    if (typeof error === 'string') return truncate(error)
    if (typeof error?.message === 'string') return truncate(error.message)
    if (typeof json?.message === 'string') return truncate(json.message)
  } catch {
    // 不是 JSON，当作纯文本处理
    const text = body.trim()
    if (text.length > 0 && text.length < 200 && !text.startsWith('<')) {
      return truncate(text)
    }
  }
  return ''
}

function truncate(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 网络层面的错误（超时、连不上等） */
export function describeNetworkError(
  error: unknown,
  language: UiLanguage = 'zh'
): LlmError {
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()

  if (lower.includes('abort') || lower.includes('canceled') || lower.includes('cancelled')) {
    return { message: t(language, 'error.cancelled') }
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return {
      message: t(language, 'error.timeout'),
      suggestion: t(language, 'error.timeoutHint')
    }
  }

  if (
    lower.includes('enotfound') ||
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('network') ||
    lower.includes('fetch failed')
  ) {
    return {
      message: t(language, 'error.network'),
      suggestion: t(language, 'error.networkHint')
    }
  }

  return {
    message: t(language, 'error.generic', { message: raw }),
    suggestion: t(language, 'error.genericHint')
  }
}
