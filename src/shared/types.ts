/** 目标：最终提示词要交给谁 */
export type Target = 'local' | 'web'

/** 模式：优化后提示词的写法 */
export type Mode = 'auto' | 'simple' | 'markdown'

/** 优化后实际采用的模式（自动模式下由模型决定） */
export type ResolvedMode = 'simple' | 'markdown'

/** 回复格式要求 */
export type ReplyFormat = 'none' | 'markdown' | 'plain'

/** 文件权限 */
export type Permission = 'editable' | 'readonly'

/** 语料标题的来源 */
export type TitleSource = 'user' | 'ai' | 'none'

/** 一份文件资料。只记录元信息，绝不读取内容。 */
export interface FileResource {
  id: string // F1、F2……
  name: string
  path: string
  ext: string
  size: number
  mtime: number
  note: string // 用途备注
  permission: Permission
}

/** 一个语料块 */
export interface CorpusResource {
  id: string // C1、C2……
  title: string
  titleSource: TitleSource
  content: string
  chars: number
  createdAt: number
}

/** 草稿状态 */
export type DraftStatus = 'editing' | 'copied'

/** 澄清问题的回答状态 */
export type AnswerState = 'chosen' | 'custom' | 'delegated'

export interface ClarifyQuestion {
  no: number
  question: string
  options: string[]
}

export interface ClarifyAnswer {
  state: AnswerState
  value: string
}

export interface Usage {
  input: number
  output: number
  cached: number
  estimated: boolean
}

export interface OptimizationState {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  intent: string
  resolvedMode: ResolvedMode | null
  questions: ClarifyQuestion[]
  answers: Record<string, ClarifyAnswer>
  intentCorrection: string | null
  usage: Usage | null
}

export interface Draft {
  id: string
  status: DraftStatus
  intentText: string
  files: FileResource[]
  corpora: CorpusResource[]
  nextFileNo: number
  nextCorpusNo: number
  target: Target
  mode: Mode
  styleId: string
  replyFormat: ReplyFormat
  optimization: OptimizationState | null
  result: { text: string; editedByUser: boolean; stale: boolean } | null
  lastAction: 'optimize' | 'tidy' | null
  /**
   * 连续触发"模型未按格式输出"兜底的次数。
   * 用户改过提示词后连续两次兜底，就提示他检查提示词。
   */
  fallbackStreak: number
  updatedAt: number
}

/** 组装结果 */
export interface AssembleResult {
  text: string
  /** 需要在网页端手动上传的文件 */
  uploads: FileResource[]
  warnings: AssembleWarning[]
}

export interface AssembleWarning {
  kind: 'missing-ref' | 'missing-file' | 'unreferenced' | 'too-long' | 'duplicate-name'
  message: string
}

/** 新建一张空草稿 */
export function createDraft(id: string): Draft {
  return {
    id,
    status: 'editing',
    intentText: '',
    files: [],
    corpora: [],
    nextFileNo: 1,
    nextCorpusNo: 1,
    target: 'local',
    mode: 'auto',
    styleId: 'clear-direct',
    replyFormat: 'none',
    optimization: null,
    result: null,
    lastAction: null,
    fallbackStreak: 0,
    updatedAt: Date.now()
  }
}

/** 生成草稿 id，格式 d_20261015_143012 */
export function draftId(now: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `d_${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}
