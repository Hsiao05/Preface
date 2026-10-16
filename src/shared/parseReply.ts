/**
 * 解析模型的行协议输出。
 *
 * 模型按 docs/SPEC.md 第七节的"输出协议"块回答，格式是：
 *   【意图】一句话复述
 *   【模式】简单 或 Markdown（只在用户选了"自动"时输出）
 *   【标题】C编号=标题（每个未命名语料一行）
 *   然后二选一：
 *   【结果】后面是正文
 *   【提问】后面每行一个问题，格式 "序号. 问题|选项|选项"
 *
 * 【解析要宽松】模型的输出不可信，行协议要宽松解析并且有兜底。
 */

export interface ParsedQuestion {
  no: number
  question: string
  options: string[]
}

export interface ParsedReply {
  /** 意图复述 */
  intent: string | null
  /** 模型选择的模式（只在"自动"时出现） */
  mode: 'simple' | 'markdown' | null
  /** 语料标题：编号 → 标题 */
  titles: Record<string, string>
  /** 结果正文 */
  result: string | null
  /** 澄清问题 */
  questions: ParsedQuestion[]
  /** 既没有【结果】也没有【提问】，走了兜底 */
  fellBack: boolean
}

/** 把模型输出的模式文字转成内部取值 */
function parseMode(text: string): 'simple' | 'markdown' | null {
  const t = text.trim().toLowerCase()
  if (t.includes('markdown')) return 'markdown'
  if (t.includes('简单') || t.includes('simple')) return 'simple'
  return null
}

/** 解析一行标题，格式 "C1=标题" */
function parseTitle(line: string): { id: string; title: string } | null {
  const match = line.match(/^\s*(C\d+)\s*[=＝]\s*(.+?)\s*$/)
  if (!match) return null
  return { id: match[1], title: match[2] }
}

/**
 * 解析一行问题，格式 "1. 问题|选项|选项"
 * 选项少于 2 个的问题丢弃。
 */
function parseQuestion(line: string): ParsedQuestion | null {
  const match = line.match(/^\s*(\d+)\s*[.、．]\s*(.+)$/)
  if (!match) return null

  const no = Number(match[1])
  const rest = match[2]

  const parts = rest.split('|').map((p) => p.trim())
  const question = parts[0]
  const options = parts.slice(1).filter((p) => p.length > 0)

  // 选项少于 2 个的问题丢弃（文档明确要求）
  if (options.length < 2) return null

  return { no, question, options }
}

/** 去掉行首的行协议标记，判断这一行是什么 */
function infoTagOf(line: string): string | null {
  const match = line.match(/^\s*【(意图|模式|标题|结果|提问)】\s*(.*)$/)
  return match ? match[1] : null
}

/**
 * 解析模型的完整输出。
 */
export function parseReply(raw: string): ParsedReply {
  const lines = raw.split('\n')

  let intent: string | null = null
  let mode: 'simple' | 'markdown' | null = null
  const titles: Record<string, string> = {}
  let result: string | null = null
  const questions: ParsedQuestion[] = []

  // 先找【结果】或【提问】的位置，它决定了后面内容的归属
  let resultIndex = -1
  let questionIndex = -1

  for (let i = 0; i < lines.length; i++) {
    const tag = infoTagOf(lines[i])
    if (tag === '结果' && resultIndex === -1) {
      resultIndex = i
      break
    }
    if (tag === '提问' && questionIndex === -1) {
      questionIndex = i
      break
    }
  }

  // 收集信息行（在【结果】或【提问】之前的部分）
  const boundary = resultIndex >= 0 ? resultIndex : questionIndex >= 0 ? questionIndex : lines.length
  for (let i = 0; i < boundary; i++) {
    const line = lines[i]
    const tag = infoTagOf(line)

    if (tag === '意图') {
      intent = line.replace(/^\s*【意图】\s*/, '').trim() || null
    } else if (tag === '模式') {
      mode = parseMode(line.replace(/^\s*【模式】\s*/, ''))
    } else if (tag === '标题') {
      const parsed = parseTitle(line.replace(/^\s*【标题】\s*/, ''))
      if (parsed) titles[parsed.id] = parsed.title
    }
    // 信息行之外的内容忽略（模型可能写了些前言）
  }

  if (resultIndex >= 0) {
    // 【结果】后面的全部内容都是正文
    const firstLine = lines[resultIndex].replace(/^\s*【结果】\s*/, '')
    const body = [firstLine, ...lines.slice(resultIndex + 1)].join('\n')
    result = stripCodeFence(body.trim())
  } else if (questionIndex >= 0) {
    const firstLine = lines[questionIndex].replace(/^\s*【提问】\s*/, '')
    const rest = [firstLine, ...lines.slice(questionIndex + 1)]
    for (const line of rest) {
      if (!line.trim()) continue
      const q = parseQuestion(line)
      if (q) questions.push(q)
    }
  }

  // 兜底：既没有【结果】也没有【提问】
  // 把去掉信息行之后的全部内容当作结果，并标记出来让界面提示用户
  if (resultIndex === -1 && questionIndex === -1) {
    const remaining = lines
      .filter((line) => infoTagOf(line) === null)
      .join('\n')
      .trim()

    if (remaining) {
      return {
        intent,
        mode,
        titles,
        result: stripCodeFence(remaining),
        questions: [],
        fellBack: true
      }
    }

    // 连内容都没有
    return { intent, mode, titles, result: null, questions: [], fellBack: true }
  }

  // 有【提问】但一个问题都没解析出来（选项都少于 2 个），也走兜底
  if (questionIndex >= 0 && questions.length === 0) {
    return { intent, mode, titles, result: null, questions: [], fellBack: true }
  }

  return { intent, mode, titles, result, questions, fellBack: false }
}

/** 去掉包裹全文的代码块标记 */
function stripCodeFence(text: string): string {
  const match = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/)
  return match ? match[1].trim() : text
}

/**
 * 流式解析：判断目前收到的内容里出现了【结果】还是【提问】。
 * 界面靠它决定显示"正在分析…"还是开始把内容写进结果页。
 */
export function detectStreamPhase(accumulated: string): 'analyzing' | 'result' | 'questions' {
  const lines = accumulated.split('\n')
  for (const line of lines) {
    const tag = infoTagOf(line)
    if (tag === '结果') return 'result'
    if (tag === '提问') return 'questions'
  }
  return 'analyzing'
}

/**
 * 从流式内容里取出【结果】之后的部分。
 * 还没看到【结果】时返回空字符串。
 *
 * 注意去掉开头的换行：标记独占一行时，第一行正文前面会多一个换行符，
 * 直接显示出来结果页顶部会空一行。
 */
export function extractStreamResult(accumulated: string): string {
  const lines = accumulated.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const tag = infoTagOf(lines[i])
    if (tag === '结果') {
      const firstLine = lines[i].replace(/^\s*【结果】\s*/, '')
      const body = [firstLine, ...lines.slice(i + 1)].join('\n')
      // 去掉开头的换行，但保留正文内部和结尾的（结尾可能还在流式增长）
      return body.replace(/^\n+/, '')
    }
  }
  return ''
}
