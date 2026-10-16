import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { ArrowUndo20Regular, Delete20Regular } from '@fluentui/react-icons'
import { useStore } from '../../store'
import type { SnapshotSummary } from '../../../preload/index'

/**
 * 「找回之前的内容」（设置 → 通用）。
 *
 * 列出历史快照，可以恢复任意一版、删掉某一版、清空全部，
 * 还可以设置保留时长。
 */

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px'
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.6'
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    maxHeight: '280px',
    overflowY: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '6px'
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  preview: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: tokens.fontSizeBase300
  },
  meta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  },
  empty: {
    padding: '16px',
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end'
  },
  grow: {
    flex: 1
  }
})

/** 保留时长选项 */
const RETENTION_CHOICES: Array<{ value: number; label: string }> = [
  { value: 10, label: '10 分钟' },
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 300, label: '5 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '24 小时' },
  { value: 0, label: '永不删除' }
]

function retentionLabel(minutes: number): string {
  return RETENTION_CHOICES.find((c) => c.value === minutes)?.label ?? `${minutes} 分钟`
}

/** 把时间戳显示成"x 分钟前" */
function timeAgo(timestamp: number): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

/** 保存原因的显示文字 */
function reasonLabel(reason: SnapshotSummary['reason']): string {
  if (reason === 'copied') return '复制时保存'
  if (reason === 'cleared') return '清空时保存'
  return '手动保存'
}

interface Props {
  onNotice: (n: { text: string; kind: 'info' | 'warning' | 'success' } | null) => void
}

export function HistoryPanel({ onNotice }: Props): JSX.Element {
  const styles = useStyles()
  const [snapshots, setSnapshots] = useState<SnapshotSummary[] | null>(null)
  const [retention, setRetention] = useState<number>(1440)
  const [clearAllOpen, setClearAllOpen] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const list = await window.preface.listSnapshots()
    setSnapshots(list)
  }, [])

  useEffect(() => {
    void (async () => {
      const settings = await window.preface.getSettings()
      setRetention(settings.snapshotRetentionMinutes)
      await reload()
    })()
  }, [reload])

  /** 改保留时长 */
  const changeRetention = async (minutes: number): Promise<void> => {
    setRetention(minutes)
    await window.preface.setSettings({ snapshotRetentionMinutes: minutes })
    // 立刻按新规则清理，并刷新列表
    await reload()
    onNotice({
      kind: 'success',
      text:
        minutes === 0
          ? '已设为永不删除。'
          : `已设为保留 ${retentionLabel(minutes)}，更早的已清理。`
    })
  }

  /** 恢复某一版 */
  const restore = async (id: string): Promise<void> => {
    const draft = await window.preface.loadSnapshot(id)
    if (!draft) {
      onNotice({ kind: 'warning', text: '这份记录读不出来了，可能已经损坏。' })
      await reload()
      return
    }

    const state = useStore.getState()
    state.setDraft(draft)
    state.setActiveTab('source')
    state.setNotice({ kind: 'success', text: '已恢复。' })
    onNotice({ kind: 'success', text: '已恢复到主窗口，关掉设置就能看到。' })
  }

  /** 删掉某一版 */
  const remove = async (id: string): Promise<void> => {
    await window.preface.deleteSnapshot(id)
    await reload()
    onNotice({ kind: 'info', text: '已删除这份记录。' })
  }

  /** 清空全部 */
  const clearAll = async (): Promise<void> => {
    const count = await window.preface.clearAllSnapshots()
    setClearAllOpen(false)
    await reload()
    onNotice({ kind: 'success', text: `已清空 ${count} 份记录。` })
  }

  return (
    <div className={styles.section}>
      <div className={styles.hint}>
        每次复制成功或点一键清空时，都会自动存一份。恢复后内容会直接进主窗口，替换当前草稿。
      </div>

      <Field label="保留时长" hint="超过这个时间的记录会自动删除。">
        <Dropdown
          value={retentionLabel(retention)}
          selectedOptions={[String(retention)]}
          onOptionSelect={(_, d) => void changeRetention(Number(d.optionValue))}
        >
          {RETENTION_CHOICES.map((choice) => (
            <Option key={choice.value} value={String(choice.value)}>
              {choice.label}
            </Option>
          ))}
        </Dropdown>
      </Field>

      {snapshots === null ? (
        <Spinner label="正在读取" />
      ) : snapshots.length === 0 ? (
        <div className={styles.list}>
          <div className={styles.empty}>还没有保存过记录。</div>
        </div>
      ) : (
        <div className={styles.list}>
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className={styles.item}>
              <div className={styles.itemMain}>
                <Text className={styles.preview}>
                  {snapshot.preview || '（没有原文）'}
                  {snapshot.intentChars > 60 ? '…' : ''}
                </Text>
                <span className={styles.meta}>
                  {timeAgo(snapshot.savedAt)} · {reasonLabel(snapshot.reason)}
                  {snapshot.fileCount > 0 && ` · ${snapshot.fileCount} 个文件`}
                  {snapshot.corpusCount > 0 && ` · ${snapshot.corpusCount} 个语料`}
                  {snapshot.hasResult && ' · 有优化结果'}
                </span>
              </div>

              <Button
                size="small"
                appearance="primary"
                icon={<ArrowUndo20Regular />}
                onClick={() => void restore(snapshot.id)}
              >
                恢复
              </Button>
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete20Regular />}
                aria-label="删除这份记录"
                onClick={() => void remove(snapshot.id)}
              />
            </div>
          ))}
        </div>
      )}

      <div className={styles.row}>
        <Button
          className={styles.grow}
          appearance="secondary"
          icon={<Delete20Regular />}
          disabled={!snapshots || snapshots.length === 0}
          onClick={() => setClearAllOpen(true)}
        >
          清除所有缓存
        </Button>
      </div>

      <Dialog open={clearAllOpen} onOpenChange={(_, d) => !d.open && setClearAllOpen(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>清除所有缓存</DialogTitle>
            <DialogContent>
              会删掉全部 {snapshots?.length ?? 0} 份记录，删了找不回来。确定吗？
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setClearAllOpen(false)}>
                取消
              </Button>
              <Button appearance="primary" onClick={() => void clearAll()}>
                清除
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}
