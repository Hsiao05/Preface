import { type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { ArrowDownload20Regular, Folder20Regular } from '@fluentui/react-icons'
import type { FileResource } from '../../shared/types'
import { formatSize } from '../format'
import { useT } from '../i18n'

const useStyles = makeStyles({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    maxHeight: '46vh',
    overflowY: 'auto'
  },
  hint: {
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '1.6',
    marginBottom: '4px'
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    cursor: 'grab',
    '&:active': { cursor: 'grabbing' }
  },
  name: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  meta: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap'
  },
  /**
   * 「全部拖出」的外观。
   *
   * 刻意做得和 Fluent 的 secondary 按钮一样，但它是个拖动源而不是按钮 ——
   * 所以用 div 自己做，并加上抓取光标提示"这个可以拖"。
   */
  dragAll: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: '96px',
    height: '32px',
    justifyContent: 'center',
    padding: '0 12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    lineHeight: tokens.lineHeightBase300,
    userSelect: 'none',
    cursor: 'grab',
    '&:active': { cursor: 'grabbing' },
    '&:focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '1px'
    }
  },
  /** 没有文件可拖时变灰 */
  dragAllDisabled: {
    color: tokens.colorNeutralForegroundDisabled,
    border: `1px solid ${tokens.colorNeutralStrokeDisabled}`,
    cursor: 'default',
    '&:active': { cursor: 'default' }
  }
})

interface Props {
  open: boolean
  files: FileResource[]
  onClose: () => void
}

export function UploadListDialog({ open, files, onClose }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()

  const dragOut = (paths: string[]): void => {
    void window.preface.startDrag(paths)
  }

  /**
   * 发起一次"把文件拖出去"。
   *
   * 【为什么必须在 dragstart 里同步调用】
   * webContents.startDrag 只是"接管当前这次拖动"，它自己不会发起拖动。
   * 拖动会话只有真实的拖拽手势才会产生，所以这个方法必须同步地写在
   * dragstart 处理函数里。
   *
   * 【为什么原来的「全部拖出」没反应】
   * 那个按钮用的是 onClick。点击不产生拖动会话，startDrag 就没有东西
   * 可以接管，于是什么都没发生 —— 这就是"按住拖动没有任何反应"的原因。
   *
   * 【preventDefault 的作用】
   * 先取消浏览器自己的 HTML5 拖动，再交给 startDrag 换成系统的原生
   * 文件拖动（拖出来的才会是文件，而不是一段文字）。这是 Electron
   * 官方文档给的写法，和上面单个文件那几行保持一致。
   */
  const beginDragOut = (event: React.DragEvent, paths: string[]): void => {
    event.preventDefault()
    if (paths.length === 0) return
    dragOut(paths)
  }

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('upload.title')}</DialogTitle>
          <DialogContent className={styles.content}>
            <div className={styles.hint}>{t('upload.hint')}</div>

            {files.map((file) => (
              <div
                key={file.id}
                className={styles.row}
                draggable
                onDragStart={(event) => beginDragOut(event, [file.path])}
                title={file.path}
              >
                <span>{file.id}</span>
                <span className={styles.name}>{file.name}</span>
                <span className={styles.meta}>{formatSize(file.size)}</span>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Folder20Regular />}
                  onClick={() => void window.preface.showInFolder(file.path)}
                >
                  {t('upload.showInFolder')}
                </Button>
              </div>
            ))}
          </DialogContent>
          <DialogActions>
            {/*
              「全部拖出」是一个拖动源，所以这里不能用 Fluent 的 Button ——
              它渲染出来的 <button> 拖不起来。用 div 自己做一个按钮外观，
              和上面每一行文件的拖动源保持同一种做法。

              role/tabIndex 手动补上：它不是真的按钮（点了没反应），
              但要让读屏和键盘能找得到它。
            */}
            <div
              className={`${styles.dragAll} ${files.length === 0 ? styles.dragAllDisabled : ''}`}
              role="button"
              tabIndex={files.length > 0 ? 0 : -1}
              aria-disabled={files.length === 0}
              draggable={files.length > 0}
              onDragStart={(event) => beginDragOut(event, files.map((f) => f.path))}
            >
              <ArrowDownload20Regular />
              <span>{t('upload.dragAll')}</span>
            </div>
            <Button appearance="primary" onClick={onClose}>
              {t('upload.gotIt')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
