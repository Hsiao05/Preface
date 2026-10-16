/**
 * Base URL 规范化。必须与 docs/SPEC.md 第五节一致。
 *
 * 规则：
 * 1. 去掉首尾空格，去掉末尾的斜杠
 * 2. 用户填的是完整接口地址时，去掉多余的路径部分
 *    - OpenAI 格式去掉 /chat/completions
 *    - Anthropic 格式去掉 /v1/messages
 * 3. OpenAI：对话是 {base}/chat/completions，模型列表是 {base}/models
 * 4. Anthropic：对话是 {base}/v1/messages，模型列表是 {base}/v1/models
 *    如果 base 已经以 /v1 结尾，就不要再重复添加
 */

export type ApiFormat = 'openai' | 'anthropic'

/** 规范化 Base URL，返回可以拼接接口路径的地址 */
export function normalizeBaseUrl(rawUrl: string, format: ApiFormat): string {
  let url = rawUrl.trim()
  if (!url) return ''

  // 去掉末尾所有斜杠
  url = url.replace(/\/+$/, '')

  if (format === 'openai') {
    // 去掉完整接口地址里多余的路径
    url = url.replace(/\/chat\/completions$/, '')
    // 有些用户会填 /v1/chat/completions 之外的形式，也一并处理
    url = url.replace(/\/completions$/, '')
    url = url.replace(/\/+$/, '')
    return url
  }

  // Anthropic
  url = url.replace(/\/v1\/messages$/, '')
  url = url.replace(/\/messages$/, '')
  url = url.replace(/\/+$/, '')
  return url
}

/** 对话接口的完整地址 */
export function chatEndpoint(baseUrl: string, format: ApiFormat): string {
  const base = normalizeBaseUrl(baseUrl, format)
  if (format === 'openai') {
    return `${base}/chat/completions`
  }
  return withV1(base, format) + '/messages'
}

/** 模型列表接口的完整地址 */
export function modelsEndpoint(baseUrl: string, format: ApiFormat): string {
  const base = normalizeBaseUrl(baseUrl, format)
  if (format === 'openai') {
    return `${base}/models`
  }
  return withV1(base, format) + '/models'
}

/** Anthropic 格式需要 /v1，但 base 已经以 /v1 结尾时不要重复添加 */
function withV1(base: string, format: ApiFormat): string {
  if (format !== 'anthropic') return base
  return /\/v1$/.test(base) ? base : `${base}/v1`
}

/**
 * OpenAI 格式收到 404 时的补救：如果 base 里没有 /v1，补上再试一次。
 * 返回补全后的地址，以及是否做了补全。
 */
export function suggestV1Retry(baseUrl: string, format: ApiFormat): { url: string; changed: boolean } {
  const base = normalizeBaseUrl(baseUrl, format)
  if (format !== 'openai') return { url: base, changed: false }
  if (/\/v\d+$/.test(base)) return { url: base, changed: false }
  return { url: `${base}/v1`, changed: true }
}

/** 从完整地址里提取出主机名，用于界面上的隐私提示 */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}
