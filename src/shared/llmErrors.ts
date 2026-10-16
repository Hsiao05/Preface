/**
 * 把各种失败情况翻译成中文说明和建议。
 * 文档第五节：模型请求出错时，用中文说明原因和建议，不能只显示英文报错。
 */

export interface LlmError {
  /** 简短的原因 */
  message: string
  /** 下一步该怎么做 */
  suggestion?: string
  /** HTTP 状态码，没有则为 undefined */
  status?: number
}

export function describeHttpError(status: number, body?: string): LlmError {
  // 服务商返回的错误正文里可能有关键信息，但不要整段展示
  const detail = extractDetail(body)

  switch (true) {
    case status === 401 || status === 403:
      return {
        message: 'API Key 不正确或没有权限',
        suggestion: '请到设置里检查 API Key 是否填对、是否已过期。',
        status
      }

    case status === 404:
      return {
        message: '地址或模型名可能有误',
        suggestion: '请检查 Base URL 和模型名。有些服务需要在地址后面加 /v1。',
        status
      }

    case status === 429:
      return {
        message: '请求太频繁或额度不足',
        suggestion: '请稍后再试，或检查账户余额。',
        status
      }

    case status === 400:
      return {
        message: detail ? `请求被拒绝：${detail}` : '请求格式有问题',
        suggestion: '请检查模型名是否正确，或换一个模型试试。',
        status
      }

    case status >= 500:
      return {
        message: '服务商暂时出错',
        suggestion: '这不是你的问题，请稍后再试。',
        status
      }

    default:
      return {
        message: detail ? `请求失败（${status}）：${detail}` : `请求失败（${status}）`,
        suggestion: '请检查设置里的地址和模型名。',
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
export function describeNetworkError(error: unknown): LlmError {
  const raw = error instanceof Error ? error.message : String(error)
  const lower = raw.toLowerCase()

  if (lower.includes('abort') || lower.includes('canceled') || lower.includes('cancelled')) {
    return { message: '请求已取消' }
  }

  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('etimedout')) {
    return {
      message: '请求超时',
      suggestion: '服务商响应太慢。可以稍后再试，或在设置里把超时时间调长。'
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
      message: '网络连接失败',
      suggestion: '请检查网络，或者代理设置是否正确。'
    }
  }

  return {
    message: `请求失败：${raw}`,
    suggestion: '请检查设置里的地址、模型名和网络连接。'
  }
}
