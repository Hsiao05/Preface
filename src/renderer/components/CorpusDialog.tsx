import { useEffect, useRef, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { Dismiss16Regular, Sparkle16Regular } from '@fluentui/react-icons'
import { useTitle } from '../useTitle'
import { useT, useUiLanguage } from '../i18n'
import { formatNumber } from '../format'
import {
  beginTitleRequest,
  createTitleState,
  rebindTitleState,
  shouldApplyTitle,
  titleSourceAfterEdit,
  touchTitleState,
  type TitleRequestState
} from '../titleRequest'
import type { TitleSource } from '../../shared/types'

const useStyles = makeStyles({
  surface: {
    maxWidth: '680px',
    width: '92vw'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  },
  titleRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end',
    flexWrap: 'wrap'
  },
  titleInput: {
    flex: 1,
    minWidth: '220px'
  },
  /**
   * 语料文本框。
   *
   * 用原生 textarea：Fluent 的 Textarea 自带 Background1 背景，
   * 深色下是 #292929（偏灰），和编辑区的 Background3（#141414）不一致。
   */
  textarea: {
    height: '320px',
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
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  }
})

interface Props {
  open: boolean
  onClose: () => void
  /** 确认。编辑已有语料时传入 id 和当前标题来源 */
  onConfirm: (
    title: string,
    content: string,
    titleSource: TitleSource,
    editingId?: string
  ) => void
  /** 编辑已有语料时传入初始值 */
  editing?: { id: string; title: string; titleSource: TitleSource; content: string } | null
}

export function CorpusDialog({ open, onClose, onConfirm, editing }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const language = useUiLanguage()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  /** 标题来源：手填、AI 回填、还是没有 */
  const [titleSource, setTitleSource] = useState<TitleSource>('none')
  const { generate, generating, cancel } = useTitle()

  /**
   * 编辑上下文的令牌。
   *
   * 手动改标题/正文、关闭、换一份语料都会让它失效，
   * 这样迟到的 AI 结果不会覆盖用户后来的输入，也不会写进另一份语料。
   */
  const titleStateRef = useRef<TitleRequestState>(createTitleState())

  // 打开时按编辑对象填充；新建时清空
  useEffect(() => {
    if (!open) return

    const key = editing?.id ?? ''
    // 换了一份语料（或新建）：在途的旧请求作废
    const state = titleStateRef.current
    if (state.editingKey !== key) {
      titleStateRef.current = rebindTitleState(state, key)
      cancel()
    }

    if (editing) {
      setTitle(editing.title)
      setContent(editing.content)
      setTitleSource(editing.titleSource)
    } else {
      setTitle('')
      setContent('')
      setTitleSource('none')
    }
    // cancel 是稳定引用，不参与依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  /** 关闭/取消：在途请求作废，避免关掉之后结果又写回来 */
  const handleCancel = (): void => {
    titleStateRef.current = rebindTitleState(
      titleStateRef.current,
      titleStateRef.current.editingKey
    )
    cancel()
    onClose()
  }

  const handleConfirm = (): void => {
    if (!content.trim()) return
    // 关窗之前同样让在途请求作废
    titleStateRef.current = rebindTitleState(
      titleStateRef.current,
      titleStateRef.current.editingKey
    )
    cancel()
    onConfirm(title.trim(), content, titleSource, editing?.id)
    onClose()
  }

  /** 用户改标题：立刻记为手动来源，并让在途的 AI 结果作废 */
  const handleTitleChange = (value: string): void => {
    setTitle(value)
    setTitleSource(titleSourceAfterEdit(value))
    titleStateRef.current = touchTitleState(titleStateRef.current)
    if (generating) cancel()
  }

  /** 用户改正文：标题的生成依据变了，在途结果作废 */
  const handleContentChange = (value: string): void => {
    setContent(value)
    titleStateRef.current = touchTitleState(titleStateRef.current)
    if (generating) cancel()
  }

  /**
   * 让 AI 起标题：用当前文本框里的内容。
   *
   * 结果只在请求仍然有效时回填。每次点击都是一次新请求，
   * 不会因为"曾经手改过"就永远不生成。
   */
  const handleGenerateTitle = async (): Promise<void> => {
    const { state, token } = beginTitleRequest(titleStateRef.current)
    titleStateRef.current = state

    const result = await generate(content)
    if (!result) return
    if (!shouldApplyTitle(token, titleStateRef.current)) return

    setTitle(result)
    setTitleSource('ai')
  }

  const charCount = content.length
  const isEditing = Boolean(editing)

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && handleCancel()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>
            {isEditing ? t('corpus.editTitle', { id: editing?.id ?? '' }) : t('corpus.createTitle')}
          </DialogTitle>
          <DialogContent className={styles.content}>
            <Field label={t('corpus.titleLabel')}>
              <div className={styles.titleRow}>
                <Input
                  className={styles.titleInput}
                  value={title}
                  onChange={(_, data) => handleTitleChange(data.value)}
                  placeholder={t('corpus.titlePlaceholder')}
                />
                <Button
                  icon={generating ? <Spinner size="tiny" /> : <Sparkle16Regular />}
                  disabled={generating || !content.trim()}
                  onClick={() => void handleGenerateTitle()}
                >
                  {t('corpus.generateTitle')}
                </Button>
                {generating && (
                  <Button
                    appearance="subtle"
                    icon={<Dismiss16Regular />}
                    onClick={cancel}
                  >
                    {t('corpus.cancelGenerate')}
                  </Button>
                )}
              </div>
            </Field>

            <Field label={t('corpus.contentLabel')}>
              <textarea
                className={styles.textarea}
                value={content}
                onChange={(event) => handleContentChange(event.target.value)}
                placeholder={t('corpus.contentPlaceholder')}
                spellCheck={false}
              />
            </Field>

            <div className={styles.hint}>
              {t('corpus.charCount', { count: formatNumber(charCount, language) })}
            </div>
          </DialogContent>

          <DialogActions>
            <Button appearance="secondary" onClick={handleCancel}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" onClick={handleConfirm} disabled={!content.trim()}>
              {isEditing ? t('common.save') : t('corpus.add')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
