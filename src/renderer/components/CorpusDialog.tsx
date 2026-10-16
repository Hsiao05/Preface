import { useEffect, useState, type JSX } from 'react'
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
import { Sparkle16Regular } from '@fluentui/react-icons'
import { useTitle } from '../useTitle'

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
    alignItems: 'flex-end'
  },
  titleInput: {
    flex: 1
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
  /** 确认。编辑已有语料时传入 id */
  onConfirm: (title: string, content: string, editingId?: string) => void
  /** 编辑已有语料时传入初始值 */
  editing?: { id: string; title: string; content: string } | null
}

export function CorpusDialog({ open, onClose, onConfirm, editing }: Props): JSX.Element {
  const styles = useStyles()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const { generate, generating } = useTitle()

  // 打开时按编辑对象填充；新建时清空
  useEffect(() => {
    if (!open) return
    if (editing) {
      setTitle(editing.title)
      setContent(editing.content)
    } else {
      setTitle('')
      setContent('')
    }
  }, [open, editing])

  const handleConfirm = (): void => {
    if (!content.trim()) return
    onConfirm(title.trim(), content, editing?.id)
    onClose()
  }

  const handleCancel = (): void => {
    onClose()
  }

  /** 让 AI 起标题：用当前文本框里的内容 */
  const handleGenerateTitle = async (): Promise<void> => {
    const result = await generate(content)
    if (result) setTitle(result)
  }

  const charCount = content.length
  const isEditing = Boolean(editing)

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && handleCancel()}>
      <DialogSurface className={styles.surface}>
        <DialogBody>
          <DialogTitle>{isEditing ? `编辑语料 ${editing?.id}` : '粘贴语料'}</DialogTitle>
          <DialogContent className={styles.content}>
            <Field label="标题（可以不填，之后可以让 AI 起标题）">
              <div className={styles.titleRow}>
                <Input
                  className={styles.titleInput}
                  value={title}
                  onChange={(_, data) => setTitle(data.value)}
                  placeholder="例如：客户口头反馈整理"
                />
                <Button
                  icon={generating ? <Spinner size="tiny" /> : <Sparkle16Regular />}
                  disabled={generating || !content.trim()}
                  onClick={() => void handleGenerateTitle()}
                >
                  AI总结标题
                </Button>
              </div>
            </Field>

            <Field label="内容">
              <textarea
                className={styles.textarea}
                value={content}
                onChange={(event) => setContent(event.target.value)}
                placeholder="把大段文字粘贴到这里"
                spellCheck={false}
              />
            </Field>

            <div className={styles.hint}>已输入 {charCount.toLocaleString('zh-CN')} 字</div>
          </DialogContent>

          <DialogActions>
            <Button appearance="secondary" onClick={handleCancel}>
              取消
            </Button>
            <Button appearance="primary" onClick={handleConfirm} disabled={!content.trim()}>
              {isEditing ? '保存' : '添加'}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
