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
import { useT, useUiLanguage } from '../../i18n'
import { formatNumber } from '../../format'
import type { TFunction, UiLanguage } from '../../../shared/i18n'
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
const RETENTION_CHOICES: number[] = [10, 30, 60, 120, 300, 720, 1440, 0]

function retentionLabel(minutes: number, t: TFunction, language: UiLanguage): string {
  if (minutes === 0) return t('history.never')
  return minutes < 60
    ? t('history.durationMinutes', { count: formatNumber(minutes, language) })
    : t('history.durationHours', { count: formatNumber(minutes / 60, language) })
}

/** 把时间戳显示成"x 分钟前" */
function timeAgo(timestamp: number, language: UiLanguage, justNow: string): string {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) return justNow

  const rtf = new Intl.RelativeTimeFormat(language === 'en' ? 'en' : 'zh-CN', {
    numeric: 'auto'
  })
  if (minutes < 60) return rtf.format(-minutes, 'minute')

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')

  const days = Math.floor(hours / 24)
  return rtf.format(-days, 'day')
}

/** 保存原因的显示文字 */
function reasonLabel(reason: SnapshotSummary['reason'], t: TFunction): string {
  if (reason === 'copied') return t('history.savedCopied')
  if (reason === 'cleared') return t('history.savedCleared')
  return t('history.savedManual')
}

interface Props {
  onNotice: (n: { text: string; kind: 'info' | 'warning' | 'success' } | null) => void
}

export function HistoryPanel({ onNotice }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const language = useUiLanguage()
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
          ? t('history.setNever')
          : t('history.setRetention', { duration: retentionLabel(minutes, t, language) })
    })
  }

  /** 恢复某一版 */
  const restore = async (id: string): Promise<void> => {
    const draft = await window.preface.loadSnapshot(id)
    if (!draft) {
      onNotice({ kind: 'warning', text: t('history.corrupt') })
      await reload()
      return
    }

    const state = useStore.getState()
    // 恢复历史 = 换草稿：旧会话作废，会话回到该记录自己的状态
    state.replaceDraft(draft)
    state.setActiveTab('source')
    state.setNotice({ kind: 'success', text: t('history.restored') })
    onNotice({ kind: 'success', text: t('history.restoredHint') })
  }

  /** 删掉某一版 */
  const remove = async (id: string): Promise<void> => {
    await window.preface.deleteSnapshot(id)
    await reload()
    onNotice({ kind: 'info', text: t('history.deleted') })
  }

  /** 清空全部 */
  const clearAll = async (): Promise<void> => {
    const count = await window.preface.clearAllSnapshots()
    setClearAllOpen(false)
    await reload()
    onNotice({
      kind: 'success',
      text: t('history.cleared', { count: formatNumber(count, language) })
    })
  }

  return (
    <div className={styles.section}>
      <div className={styles.hint}>{t('history.intro')}</div>

      <Field label={t('history.retention')} hint={t('history.retentionHint')}>
        <Dropdown
          value={retentionLabel(retention, t, language)}
          selectedOptions={[String(retention)]}
          onOptionSelect={(_, d) => void changeRetention(Number(d.optionValue))}
        >
          {RETENTION_CHOICES.map((minutes) => (
            <Option key={minutes} value={String(minutes)}>
              {retentionLabel(minutes, t, language)}
            </Option>
          ))}
        </Dropdown>
      </Field>

      {snapshots === null ? (
        <Spinner label={t('history.loading')} />
      ) : snapshots.length === 0 ? (
        <div className={styles.list}>
          <div className={styles.empty}>{t('history.empty')}</div>
        </div>
      ) : (
        <div className={styles.list}>
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className={styles.item}>
              <div className={styles.itemMain}>
                <Text className={styles.preview}>
                  {snapshot.preview || t('history.noSource')}
                  {snapshot.intentChars > 60 ? '…' : ''}
                </Text>
                <span className={styles.meta}>
                  {timeAgo(snapshot.savedAt, language, t('history.justNow'))} ·{' '}
                  {reasonLabel(snapshot.reason, t)}
                  {snapshot.fileCount > 0 &&
                    ` · ${t('history.files', {
                      count: formatNumber(snapshot.fileCount, language)
                    })}`}
                  {snapshot.corpusCount > 0 &&
                    ` · ${t('history.corpora', {
                      count: formatNumber(snapshot.corpusCount, language)
                    })}`}
                  {snapshot.hasResult && ` · ${t('history.hasResult')}`}
                </span>
              </div>

              <Button
                size="small"
                appearance="primary"
                icon={<ArrowUndo20Regular />}
                onClick={() => void restore(snapshot.id)}
              >
                {t('history.restore')}
              </Button>
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete20Regular />}
                aria-label={t('history.deleteAria')}
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
          {t('history.clearAll')}
        </Button>
      </div>

      <Dialog open={clearAllOpen} onOpenChange={(_, d) => !d.open && setClearAllOpen(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('history.clearAll')}</DialogTitle>
            <DialogContent>
              {t('history.clearAllBody', {
                count: formatNumber(snapshots?.length ?? 0, language)
              })}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setClearAllOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" onClick={() => void clearAll()}>
                {t('history.clear')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  )
}
