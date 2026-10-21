import { translate } from '../../shared/i18n'
import { getUiLanguage } from '../i18n'

/**
 * 语音识别过程中可能出现的错误。
 * 消息跟随设置里的界面语言，界面直接显示。
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
    return this.suggestion
      ? translate(getUiLanguage(), 'speech.errorWithSuggestion', {
          message: this.message,
          suggestion: this.suggestion
        })
      : this.message
  }
}
