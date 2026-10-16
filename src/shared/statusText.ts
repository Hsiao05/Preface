import { formatTokenCount } from './estimateTokens'

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

export function buildStatusText(input: StatusTextInput): string | null {
  const { resolvedMode, mode, usage, sawReasoning, showTokenUsage = true } = input
  const parts: string[] = []

  if (resolvedMode) {
    const label = resolvedMode === 'simple' ? '简单模式' : 'Markdown 模式'
    const auto = mode === 'auto' ? '（自动判断）' : ''
    parts.push(`${label}${auto}`)
  }

  if (usage && showTokenUsage) {
    const total = (usage.input ?? 0) + (usage.output ?? 0)
    parts.push(`本次约 ${formatTokenCount(total)} tokens`)
  }

  if (sawReasoning) {
    parts.push('模型带推理过程，消耗会增加')
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
