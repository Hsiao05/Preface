import { formatTokenCount } from './estimateTokens'
import { translate, type UiLanguage } from './i18n'

/**
 * 结果区上方状态条的文字。
 *
 * 放在 shared 里是为了能直接测 —— 它是个纯函数，
 * 之前藏在 App.tsx 里只能用"断言源码里有某个字符串"的笨办法。
 */

export interface StatusTextInput {
  /** 模型选择的模式。null 表示还没判断出来 */
  resolvedMode: string | null
  /** 用户选的模式，用来判断要不要标注"自动判断" */
  mode: string
  /** 本次用量 */
  usage?: { input?: number; output?: number } | null
  /** 模型这次有没有带推理过程 */
  sawReasoning?: boolean
  /**
   * 要不要显示 Token 用量。
   * 对应「设置 → 通用 → 显示 Token 用量」，默认开。
   * 关掉只影响用量那一段，模式和推理提示照常显示。
   */
  showTokenUsage?: boolean
}

export function buildStatusText(
  input: StatusTextInput,
  language: UiLanguage = 'zh'
): string | null {
  const { resolvedMode, mode, usage, sawReasoning, showTokenUsage = true } = input
  const parts: string[] = []

  if (resolvedMode) {
    const label =
      resolvedMode === 'simple'
        ? translate(language, 'status.simpleMode')
        : translate(language, 'status.markdownMode')
    const auto = mode === 'auto' ? translate(language, 'status.auto') : ''
    parts.push(`${label}${auto}`)
  }

  if (usage && showTokenUsage) {
    const total = (usage.input ?? 0) + (usage.output ?? 0)
    parts.push(translate(language, 'status.tokens', { count: formatTokenCount(total) }))
  }

  if (sawReasoning) {
    parts.push(translate(language, 'status.reasoning'))
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
