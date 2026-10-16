import { BUILTIN_BLOCKS, type BlockId } from './prompts/blocks'
import { BUILTIN_TEMPLATES } from './prompts/templates'
import { findBuiltinStyle } from './prompts/styles'
import type { CorpusResource, FileResource, ReplyFormat } from './types'

/**
 * 组装系统提示词与消息。
 *
 * 块的顺序（文档第七节）：
 * 1 角色与任务 → 2 改写规则 → 3 简单模式写法 → 4 Markdown 模式写法 →
 * 5 输出协议 → 6 表达风格 → 7 风格样本 → 8 我的附加要求
 *
 * 块 3 和块 4 总是同时放入，这样切换模式时不用换系统提示词，可以继续命中缓存。
 */

export interface PromptOverrides {
  blocks?: Partial<Record<BlockId, string>>
  templates?: Partial<Record<'tidy' | 'title', string>>
  styles?: Record<string, string>
  styleSamples?: Record<string, string[]>
  extra?: string
}

export interface BuildSystemPromptInput {
  styleId: string
  maxQuestions: number
  overrides?: PromptOverrides
}

/** 组装优化的系统提示词 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  const { styleId, maxQuestions, overrides } = input

  const block = (id: BlockId): string => {
    // protocol 始终从代码里读，不采用用户的覆盖
    if (id === 'protocol') return BUILTIN_BLOCKS.protocol
    return overrides?.blocks?.[id] ?? BUILTIN_BLOCKS[id]
  }

  const parts: string[] = [
    block('role'),
    block('rules').replace(/\{\{最多提问数\}\}/g, String(maxQuestions)),
    block('simple'),
    block('markdown'),
    block('protocol')
  ]

  // 块 6：表达风格
  const styleText = overrides?.styles?.[styleId] ?? findBuiltinStyle(styleId)?.text
  if (styleText) {
    parts.push(`表达风格：${styleText}`)
  }

  // 块 7：风格样本（没有样本时省略）
  const samples = overrides?.styleSamples?.[styleId] ?? []
  if (samples.length > 0) {
    const sampleText = samples
      .map((s, i) => `<样本${i + 1}>\n${s}\n</样本${i + 1}>`)
      .join('\n')
    parts.push(
      `风格样本：\n以下样本只用于模仿写法（句式、编号习惯、连接词、语气、详略），不要采用其中的具体内容。\n${sampleText}`
    )
  }

  // 块 8：我的附加要求（为空时省略）
  const extra = overrides?.extra?.trim()
  if (extra) {
    parts.push(`用户的附加要求：${extra}`)
  }

  return parts.join('\n\n')
}

/** 整理碎碎念的系统提示词 */
export function buildTidySystemPrompt(
  input: {
    overrides?: PromptOverrides
    styleId?: string
    includeStyleSamples?: boolean
  } = {}
): string {
  const { overrides, styleId, includeStyleSamples } = input

  let prompt = overrides?.templates?.tidy ?? BUILTIN_TEMPLATES.tidy

  // 设置开启"整理也参考风格样本"时，才把样本追加到末尾
  if (includeStyleSamples && styleId) {
    const samples = overrides?.styleSamples?.[styleId] ?? []
    if (samples.length > 0) {
      const sampleText = samples
        .map((s, i) => `<样本${i + 1}>\n${s}\n</样本${i + 1}>`)
        .join('\n')
      prompt += `\n\n以下样本只用于模仿写法（句式、编号习惯、连接词、语气、详略），不要采用其中的具体内容。\n${sampleText}`
    }
  }

  // "我的附加要求"在整理时同样生效
  const extra = overrides?.extra?.trim()
  if (extra) {
    prompt += `\n\n用户的附加要求：${extra}`
  }

  return prompt
}

/** 语料标题的系统提示词 */
export function buildTitleSystemPrompt(overrides?: PromptOverrides): string {
  return overrides?.templates?.title ?? BUILTIN_TEMPLATES.title
}

/** 整理碎碎念的消息：user 消息就是原文本身，不附带资料清单 */
export function buildTidyMessages(
  sourceText: string,
  options: { overrides?: PromptOverrides; styleId?: string; includeStyleSamples?: boolean } = {}
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: buildTidySystemPrompt(options) },
    { role: 'user', content: sourceText }
  ]
}

/** 语料标题的消息：user 消息是语料的前 500 字 */
export function buildTitleMessages(
  content: string,
  overrides?: PromptOverrides
): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: buildTitleSystemPrompt(overrides) },
    { role: 'user', content: content.slice(0, 500) }
  ]
}

// ---------- 优化的首轮 user 消息 ----------

export interface OptimizeInputParams {
  mode: 'auto' | 'simple' | 'markdown'
  replyFormat: ReplyFormat
  files: FileResource[]
  corpora: CorpusResource[]
  intentText: string
  maxQuestions: number
  /** 提供给优化模型的语料信息：仅标题和字数 / 摘录 300 字 / 全文 */
  corpusInfo: 'title' | 'excerpt300' | 'full'
}

/**
 * 组装优化的首轮 user 消息。格式必须与文档第六节一致。
 *
 * 【重要】这里不能加入时间戳、随机数这类每次都变的内容，
 * 否则会破坏前缀缓存。
 */
export function buildOptimizeUserMessage(params: OptimizeInputParams): string {
  const { mode, replyFormat, files, corpora, intentText, maxQuestions, corpusInfo } = params

  const modeLabel = mode === 'auto' ? '自动' : mode === 'simple' ? '简单' : 'Markdown'
  const formatLabel =
    replyFormat === 'none'
      ? '不指定'
      : replyFormat === 'markdown'
        ? '要求 Markdown'
        : '要求清晰的纯文本'

  const lines: string[] = [`【模式】${modeLabel}`, `【回复格式要求】${formatLabel}`, '【资料】']

  if (files.length === 0 && corpora.length === 0) {
    lines.push('无')
  } else {
    // 文件：只写文件名、权限和用途。不写大小、类型和路径，因为改写用不到它们。
    for (const file of files) {
      const permission = file.permission === 'readonly' ? '只读' : '可修改'
      const note = file.note.trim() ? `；${file.note.trim()}` : ''
      lines.push(`@${file.id} 文件 ${file.name}（${permission}${note}）`)
    }

    // 语料：只写标题和字数
    for (const corpus of corpora) {
      const isUnnamed = !corpus.title.trim()
      const title = isUnnamed ? '未命名' : corpus.title.trim()
      let line = `@${corpus.id} 语料 ${title}（约${corpus.chars}字）`

      // 未命名的语料附带摘录，供模型起标题。标题生成一次后就保存下来，以后不再发送。
      if (isUnnamed && corpusInfo === 'title') {
        line += `摘录：（${corpus.content.slice(0, 200)}）`
      } else if (corpusInfo === 'excerpt300') {
        line += `摘录：（${corpus.content.slice(0, 300)}）`
      } else if (corpusInfo === 'full') {
        line += `全文：（${corpus.content}）`
      }

      lines.push(line)
    }
  }

  lines.push('【原文】', intentText)

  // 最多提问数为 0 时，明确要求不要提问
  if (maxQuestions === 0) {
    lines.push('本次不要提问，直接输出【结果】。')
  }

  return lines.join('\n')
}
