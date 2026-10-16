import type { CorpusResource, FileResource, ReplyFormat, Mode } from './types'
import type { ParsedQuestion, ParsedReply } from './parseReply'

/**
 * 优化的对话记录。
 *
 * 【为什么要保存整段对话】
 * 续写、补救、切换模式都接在首轮对话后面追加一条消息，而不是重新发起请求。
 * 这样有两个好处：
 *  1. 前三条消息与首轮完全相同，支持前缀缓存的服务商按更低价格计费；
 *  2. 模型能看到自己提过的问题，理解澄清结果更准确。
 */

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** 澄清问题的一种回答 */
export type AnswerState = 'chosen' | 'custom' | 'delegated'

export interface ClarifyAnswer {
  state: AnswerState
  value: string
}

export interface OptimizeSession {
  /** 首轮的 user 消息（后续所有调用都复用它） */
  firstUserMessage: string
  /** 模型的完整输出（首轮） */
  firstReply: string
  /** 解析后的首轮结果。可以不传 —— buildFollowUpMessages 用不到它 */
  parsed?: ParsedReply
  /** 澄清答案，键是问题序号 */
  answers?: Record<string, ClarifyAnswer>
  /** 用户对意图的更正 */
  intentCorrection?: string | null
  /** 已经追加的后续消息（用于重建对话） */
  followUps: ChatTurn[]
}

/**
 * 重建完整对话。
 *
 * 顺序固定为：user（首轮）→ assistant（首轮输出）→ 后续追加的消息……
 * 前两条永远不变，这样才可能命中前缀缓存。
 */
export function buildConversation(session: OptimizeSession): ChatTurn[] {
  return [
    { role: 'user', content: session.firstUserMessage },
    { role: 'assistant', content: session.firstReply },
    ...session.followUps
  ]
}

/**
 * 组装澄清结果消息（文档第六节第四步）。
 *
 * 未作答的问题不列出，序号与首轮的问题对应。
 */
export function buildClarifyMessage(session: OptimizeSession): string {
  const lines: string[] = ['【澄清结果】']

  for (const question of session.parsed?.questions ?? []) {
    const answer = session.answers?.[String(question.no)]
    if (!answer) continue // 未作答：不在提示词里提及

    if (answer.state === 'delegated') {
      lines.push(`${question.no}. 交给 AI 自行判断`)
    } else {
      lines.push(`${question.no}. 用户选择：${answer.value}`)
    }
  }

  if (session.intentCorrection) {
    lines.push(`【意图更正】\n${session.intentCorrection}`)
  }

  lines.push('请直接输出【结果】，不要再提问。')

  return lines.join('\n')
}

/** 切换模式的消息 */
export function buildModeSwitchMessage(target: 'simple' | 'markdown'): string {
  const label = target === 'markdown' ? 'Markdown' : '简单'
  return `请改用 ${label} 模式重新输出【结果】。`
}

/** 引用补救的消息（由 validateRefs 生成内容） */
export function buildRemedyTurn(remedyMessage: string): ChatTurn {
  return { role: 'user', content: remedyMessage }
}

/**
 * 组装后续调用要发的完整消息列表（含 system）。
 *
 * extraTurn 已经在 session.followUps 里时不要重复传 —— 调用方负责决定
 * 是"先 push 再调用"，还是"传进来但不 push"。
 * 这里统一按"session 里已有的 + 这一条"来拼。
 */
export function buildFollowUpMessages(
  systemPrompt: string,
  session: OptimizeSession,
  extraTurn: ChatTurn
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const conversation = buildConversation(session)
  const alreadyIncluded =
    conversation.length > 0 &&
    conversation[conversation.length - 1].role === extraTurn.role &&
    conversation[conversation.length - 1].content === extraTurn.content

  return [
    { role: 'system', content: systemPrompt },
    ...conversation,
    ...(alreadyIncluded ? [] : [extraTurn])
  ]
}

/**
 * 首轮调用要发的消息列表。
 */
export function buildFirstRoundMessages(
  systemPrompt: string,
  firstUserMessage: string
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: firstUserMessage }
  ]
}

/**
 * 判断用户是否对澄清做了任何回答。
 * 全部未作答时（点了"跳过，直接优化"），仍然要发一次续写 —— 因为
 * 首轮只输出了问题，没有结果。
 */
export function hasAnyAnswer(answers: Record<string, ClarifyAnswer>): boolean {
  return Object.keys(answers).length > 0
}

export interface OptimizeContext {
  mode: Mode
  replyFormat: ReplyFormat
  files: FileResource[]
  corpora: CorpusResource[]
  intentText: string
  maxQuestions: number
  corpusInfo: 'title' | 'excerpt300' | 'full'
}

/** 生成草稿里的优化状态（用于持久化） */
export interface OptimizationState {
  messages: ChatTurn[]
  intent: string
  resolvedMode: 'simple' | 'markdown' | null
  questions: ParsedQuestion[]
  answers: Record<string, ClarifyAnswer>
  intentCorrection: string | null
  usage: { input: number; output: number; cached: number; estimated: boolean } | null
}
