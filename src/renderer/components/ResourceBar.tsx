import { useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens,
  Tooltip
} from '@fluentui/react-components'
import { Dismiss12Regular, Mic16Regular } from '@fluentui/react-icons'
import { useStore } from '../store'
import { useT } from '../i18n'
import { countRef } from '../../shared/refs'
import { isAudioFileExt } from '../../shared/speech'
import { AudioTranscribeDialog } from './AudioTranscribeDialog'
import type { FileResource } from '../../shared/types'

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    // 资料多时自动换行，不用左右滚动
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    maxHeight: '132px',
    overflowY: 'auto',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    '&::-webkit-scrollbar': { width: '6px' },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: tokens.colorNeutralStroke1,
      borderRadius: '3px'
    }
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground4
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 4px 2px 8px',
    borderRadius: '4px',
    backgroundColor: tokens.colorNeutralBackground3,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    // 可以拖到原文里，直接生成 @ 引用
    cursor: 'grab',
    userSelect: 'none',
    '&:active': { cursor: 'grabbing' }
  },
  chipDragging: {
    opacity: 0.5
  },
  /** 音频文件：可以点击打开转录窗口 */
  chipAudio: {
    cursor: 'pointer'
  },
  micMark: {
    color: tokens.colorBrandForeground1,
    flexShrink: 0
  },
  chipMissing: {
    border: `1px solid ${tokens.colorPaletteRedBorder2}`,
    backgroundColor: tokens.colorPaletteRedBackground1
  },
  id: {
    fontFamily: tokens.fontFamilyMonospace,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold
  },
  remove: {
    minWidth: 'auto',
    width: '18px',
    height: '18px',
    padding: '0'
  },
  missingMark: {
    color: tokens.colorPaletteRedForeground1
  },
  dialogContent: {
    lineHeight: '1.6'
  }
})

interface PendingDelete {
  id: string
  label: string
  kind: 'file' | 'corpus'
  count: number
}

export function ResourceBar(): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const { draft, missingFiles, removeFile, removeCorpus } = useStore()
  const [pending, setPending] = useState<PendingDelete | null>(null)
  // 正在转录的音频文件。为 null 表示窗口关闭。
  const [audioFile, setAudioFile] = useState<FileResource | null>(null)

  const hasResources = draft.files.length > 0 || draft.corpora.length > 0

  /** 删除前检查是否被引用 */
  const requestDelete = (id: string, label: string, kind: 'file' | 'corpus'): void => {
    const count = countRef(draft.intentText, `@${id}`)
    if (count > 0) {
      setPending({ id, label, kind, count })
      return
    }
    doDelete(id, kind)
  }

  const doDelete = (id: string, kind: 'file' | 'corpus'): void => {
    if (kind === 'file') removeFile(id)
    else removeCorpus(id)
  }

  const confirmDelete = (): void => {
    if (pending) doDelete(pending.id, pending.kind)
    setPending(null)
  }

  /**
   * 把标签拖到原文里时，告诉编辑器在落点插入 @编号。
   *
   * 【注意】这里只放自定义类型，不放 text/plain。
   * CodeMirror 内置的 drop 处理器会读 dataTransfer 里的文本并自己插入一次，
   * 我们再插一次就会出现两个 @F1。只放自定义类型，内置处理器就什么都不会做。
   */
  const beginRefDrag = (event: React.DragEvent, id: string): void => {
    event.dataTransfer.setData('application/x-preface-ref', id)
    event.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <>
      <div className={styles.bar}>
        {!hasResources && (
          <span className={styles.empty}>{t('resource.empty')}</span>
        )}

        {draft.files.map((file) => {
          const missing = missingFiles.has(file.id)
          // 音频文件可以点击打开转录窗口；其他文件保持原来的纯拖动行为
          const audio = !missing && isAudioFileExt(file.ext)
          const tooltip = missing
            ? t('resource.missingTooltip')
            : audio
              ? t('resource.audioTooltip', { path: file.path })
              : t('resource.fileTooltip', { path: file.path })

          return (
            <Tooltip key={file.id} content={tooltip} relationship="label">
              <span
                className={`${styles.chip} ${missing ? styles.chipMissing : ''} ${
                  audio ? styles.chipAudio : ''
                }`}
                draggable
                onDragStart={(event) => beginRefDrag(event, file.id)}
                role={audio ? 'button' : undefined}
                tabIndex={audio ? 0 : undefined}
                onClick={audio ? () => setAudioFile(file) : undefined}
                onKeyDown={
                  audio
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setAudioFile(file)
                        }
                      }
                    : undefined
                }
              >
                {audio && <Mic16Regular className={styles.micMark} />}
                <span className={styles.id}>{file.id}</span>
                <span>{file.name}</span>
                {missing && <span className={styles.missingMark}>{t('resource.missing')}</span>}
                <Button
                  className={styles.remove}
                  appearance="transparent"
                  size="small"
                  draggable={false}
                  icon={<Dismiss12Regular />}
                  aria-label={t('resource.deleteAria', { id: file.id })}
                  onClick={(event) => {
                    // 【必须阻止冒泡】音频标签外层的 onClick 是"打开转录窗口"，
                    // 删除按钮在它里面。不拦住的话，点叉会一边删一边把转录窗口弹出来。
                    event.stopPropagation()
                    requestDelete(file.id, file.name, 'file')
                  }}
                />
              </span>
            </Tooltip>
          )
        })}

        {draft.corpora.map((corpus) => (
          <Tooltip
            key={corpus.id}
            content={t('resource.corpusTooltip', { count: corpus.chars })}
            relationship="label"
          >
            <span
              className={styles.chip}
              draggable
              onDragStart={(event) => beginRefDrag(event, corpus.id)}
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('preface:edit-corpus', { detail: { id: corpus.id } })
                )
              }
            >
              <span className={styles.id}>{corpus.id}</span>
              <span>{corpus.title.trim() || t('resource.untitledCorpus')}</span>
              <Button
                className={styles.remove}
                appearance="transparent"
                size="small"
                draggable={false}
                icon={<Dismiss12Regular />}
                aria-label={t('resource.deleteAria', { id: corpus.id })}
                onClick={(event) => {
                  // 【必须阻止冒泡】语料标签外层的 onClick 是"打开编辑窗口"，
                  // 删除按钮在它里面。不拦住的话，点叉会一边删一边把编辑窗口弹出来。
                  event.stopPropagation()
                  requestDelete(
                    corpus.id,
                    corpus.title || t('resource.untitledCorpus'),
                    'corpus'
                  )
                }}
              />
            </span>
          </Tooltip>
        ))}
      </div>

      <Dialog open={pending !== null} onOpenChange={(_, data) => !data.open && setPending(null)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('resource.deleteTitle')}</DialogTitle>
            <DialogContent className={styles.dialogContent}>
              {t('resource.deleteBody', {
                label: pending?.label ?? '',
                id: pending?.id ?? '',
                count: pending?.count ?? 0
              })}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" onClick={confirmDelete}>
                {t('common.delete')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <AudioTranscribeDialog file={audioFile} onClose={() => setAudioFile(null)} />
    </>
  )
}
