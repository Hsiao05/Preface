import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { Mic20Regular } from '@fluentui/react-icons'
import { useStore } from '../store'
import { addCorpusToDraft } from '../corpusActions'
import { appendWithSpacing } from '../../shared/appendText'
import { cleanTranscript, MAX_AUDIO_FILE_BYTES } from '../../shared/speech'
import { formatNumber, formatSize } from '../format'
import { useT, useUiLanguage } from '../i18n'
import type { FileResource } from '../../shared/types'

/**
 * 音频文件转录窗口。
 *
 * 流程：点音频标签打开 → 开始转录 → 结果可编辑 → 作为语料 / 追加到原文。
 *
 * 【隐私】音频只在用户点「开始转录」后由主进程读取一次，直接发给
 * 「设置 → 语音」里配置的服务；程序不保存副本、不写磁盘。
 */

const useStyles = makeStyles({
  surface: {
    maxWidth: '640px',
    width: '92vw'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  fileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase300
  },
  fileName: {
    fontWeight: tokens.fontWeightSemibold,
    wordBreak: 'break-all'
  },
  fileSize: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.6'
  },
  warning: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteRedForeground1,
    lineHeight: '1.6'
  },
  /** 转录结果的编辑框。和语料窗口一样用原生 textarea，深浅色都稳。 */
  textarea: {
    height: '220px',
    padding: '10px 12px',
    margin: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    outline: 'none',
    resize: 'none',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.6'
  },
  progress: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground2
  }
})

type Phase = 'idle' | 'transcribing' | 'done'

interface Props {
  /** 要转录的文件。为 null 时窗口关闭。 */
  file: FileResource | null
  onClose: () => void
}

/** 把文件名去掉扩展名，用作语料标题 */
function titleFromName(name: string): string {
  const dot = name.lastIndexOf('.')
  return (dot > 0 ? name.slice(0, dot) : name).trim()
}

/** 秒数显示成 0:05 / 1:23 */
function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function AudioTranscribeDialog({ file, onClose }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const language = useUiLanguage()
  const setNotice = useStore((s) => s.setNotice)

  const [phase, setPhase] = useState<Phase>('idle')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 用户主动取消时，迟到的结果不能再写进窗口
  const cancelledRef = useRef(false)
  // 每次开始转录加一。关掉窗口再打开时，上一次迟到的结果不能写进新窗口。
  const runIdRef = useRef(0)

  const open = file !== null
  const tooLarge = file !== null && file.size > MAX_AUDIO_FILE_BYTES

  const clearTimer = useCallback((): void => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  /** 窗口打开时重置状态，并确认语音服务配好了没有 */
  useEffect(() => {
    if (!open) return

    setPhase('idle')
    setText('')
    setError(null)
    setElapsed(0)
    setConfigured(null)
    cancelledRef.current = false

    void window.preface.getSpeechConfig().then((info) => setConfigured(info.configured))
  }, [open, file?.id])

  /** 关闭或切换文件时，正在进行的请求要停掉 */
  useEffect(() => {
    if (open) return
    cancelledRef.current = true
    // 作废还没回来的结果，免得重开窗口后被上一次的结果串台
    runIdRef.current++
    clearTimer()
    setPhase('idle')
  }, [open, clearTimer])

  useEffect(() => {
    return () => {
      clearTimer()
    }
  }, [clearTimer])

  const start = async (): Promise<void> => {
    if (!file) return

    setPhase('transcribing')
    setText('')
    setError(null)
    setElapsed(0)
    cancelledRef.current = false
    const runId = ++runIdRef.current

    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000)
    }, 200)

    const result = await window.preface.transcribeAudioFile(file.path)
    clearTimer()

    // 已取消、或者窗口已经关了又重开：这次结果作废
    if (cancelledRef.current || runId !== runIdRef.current) return

    if (!result.ok) {
      setPhase('idle')
      setError(
        result.error.suggestion
          ? `${result.error.message}。${result.error.suggestion}`
          : result.error.message
      )
      return
    }

    const cleaned = cleanTranscript(result.text)
    setText(cleaned)
    setPhase('done')
  }

  const cancel = (): void => {
    cancelledRef.current = true
    clearTimer()
    void window.preface.cancelTranscribe()
    setPhase('idle')
    setElapsed(0)
  }

  const handleClose = (): void => {
    if (phase === 'transcribing') cancel()
    onClose()
  }

  const addAsCorpus = (): void => {
    if (!file || !text.trim()) return
    const corpus = addCorpusToDraft(titleFromName(file.name), text.trim())
    setNotice({
      kind: 'success',
      text: t('audio.addedCorpus', {
        id: corpus.id,
        count: formatNumber(corpus.chars, language)
      })
    })
    onClose()
  }

  const appendToIntent = (): void => {
    if (!text.trim()) return
    const state = useStore.getState()
    const next = appendWithSpacing(state.draft.intentText, text)
    state.setIntentText(next)
    state.setActiveTab('source')
    setNotice({
      kind: 'success',
      text: t('audio.appended', {
        count: formatNumber(text.trim().length, language)
      })
    })
    onClose()
  }

  const canStart = configured === true && !tooLarge && phase !== 'transcribing'

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && handleClose()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{t('audio.title')}</DialogTitle>
          <DialogContent className={styles.content}>
            <div className={styles.fileRow}>
              <Mic20Regular />
              <span className={styles.fileName}>{file?.name}</span>
              <span className={styles.fileSize}>
                {file ? formatSize(file.size) : ''}
              </span>
            </div>

            <div className={styles.hint}>{t('audio.hint')}</div>

            {configured === false && (
              <div className={styles.warning}>{t('audio.notConfigured')}</div>
            )}

            {tooLarge && file && (
              <div className={styles.warning}>
                {t('audio.tooLarge', { size: formatSize(file.size) })}
              </div>
            )}

            {phase === 'transcribing' && (
              <div className={styles.progress}>
                <Spinner size="tiny" />
                <span>{t('audio.progress', { time: formatElapsed(elapsed) })}</span>
              </div>
            )}

            {error && <div className={styles.warning}>{error}</div>}

            {phase === 'done' && !text && (
              <div className={styles.warning}>{t('audio.emptyResult')}</div>
            )}

            {phase === 'done' && text && (
              <textarea
                className={styles.textarea}
                value={text}
                onChange={(event) => setText(event.target.value)}
                spellCheck={false}
                aria-label={t('audio.resultAria')}
              />
            )}
          </DialogContent>

          <DialogActions>
            {phase === 'transcribing' && (
              <Button appearance="secondary" onClick={cancel}>
                {t('audio.cancel')}
              </Button>
            )}

            {phase !== 'transcribing' && (
              <Button appearance="secondary" onClick={handleClose}>
                {t('common.close')}
              </Button>
            )}

            {phase === 'done' && text && (
              <>
                <Button
                  appearance="secondary"
                  onClick={() => {
                    setText('')
                    void start()
                  }}
                >
                  {t('audio.retry')}
                </Button>
                <Button appearance="secondary" onClick={appendToIntent}>
                  {t('audio.append')}
                </Button>
                <Button appearance="primary" onClick={addAsCorpus}>
                  {t('audio.addCorpus')}
                </Button>
              </>
            )}

            {phase !== 'transcribing' && !text && (
              <Button appearance="primary" disabled={!canStart} onClick={() => void start()}>
                {t('audio.start')}
              </Button>
            )}
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
