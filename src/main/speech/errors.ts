/**
 * 语音识别过程中可能出现的错误。
 * 消息一律是中文，界面直接显示。
 */
export class SpeechError extends Error {
  readonly suggestion?: string
  readonly status?: number

  constructor(message: string, suggestion?: string, status?: number) {
    super(message)
    this.name = 'SpeechError'
    this.suggestion = suggestion
    this.status = status
  }

  /** 拼成给用户看的一整句 */
  get fullMessage(): string {
    return this.suggestion ? `${this.message}。${this.suggestion}` : this.message
  }
}
