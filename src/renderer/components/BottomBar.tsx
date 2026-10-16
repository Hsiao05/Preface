import type { JSX } from 'react'
import { Button, makeStyles, tokens, Tooltip, ToggleButton } from '@fluentui/react-components'
import {
  Copy20Regular,
  Sparkle20Regular,
  TextBulletListSquare20Regular,
  ArrowUndo20Regular,
  Dismiss20Regular
} from '@fluentui/react-icons'
import { useStore } from '../store'
import type { Mode } from '../../shared/types'

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 12px 12px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`
  },
  modeRow: {
    display: 'flex',
    justifyContent: 'center'
  },
  modeGroup: {
    display: 'inline-flex',
    gap: '2px',
    padding: '2px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3
  },
  buttonRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  spacer: {
    flex: 1
  }
})

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'auto', label: '自动' },
  { value: 'simple', label: '简单' }
]

interface Props {
  onTidy: () => void
  onOptimize: () => void
  onCopy: () => void
  /** 正在进行的调用类型，null 表示空闲 */
  runningKind: 'tidy' | 'optimize' | 'followup' | 'title' | null
  onCancel: () => void
  /** 刚完成一次整理，可以撤销 */
  canUndoTidy: boolean
  onUndoTidy: () => void
}

export function BottomBar({
  onTidy,
  onOptimize,
  onCopy,
  runningKind,
  onCancel,
  canUndoTidy,
  onUndoTidy
}: Props): JSX.Element {
  const styles = useStyles()
  const { draft, setMode } = useStore()

  const hasIntent = draft.intentText.trim().length > 0
  const busy = runningKind !== null

  return (
    <div className={styles.bar}>
      <div className={styles.modeRow}>
        <Tooltip
          content={
            busy && runningKind === 'tidy'
              ? '整理碎碎念始终输出纯文本，这里的模式不影响它'
              : '模式只影响「优化提示词」'
          }
          relationship="description"
        >
          <div className={styles.modeGroup}>
            {MODES.map((m) => (
              <ToggleButton
                key={m.value}
                size="small"
                appearance="subtle"
                checked={draft.mode === m.value}
                disabled={busy}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </ToggleButton>
            ))}
          </div>
        </Tooltip>
      </div>

      <div className={styles.buttonRow}>
        {canUndoTidy && !busy && (
          <Button icon={<ArrowUndo20Regular />} appearance="subtle" onClick={onUndoTidy}>
            撤销整理
          </Button>
        )}

        {runningKind === 'tidy' ? (
          <Button icon={<Dismiss20Regular />} onClick={onCancel}>
            取消
          </Button>
        ) : (
          <Button
            icon={<TextBulletListSquare20Regular />}
            disabled={!hasIntent || busy}
            onClick={onTidy}
          >
            整理碎碎念
          </Button>
        )}

        <div className={styles.spacer} />

        {runningKind === 'optimize' || runningKind === 'followup' ? (
          <Button appearance="primary" icon={<Dismiss20Regular />} onClick={onCancel}>
            取消
          </Button>
        ) : (
          <Button
            appearance="primary"
            icon={<Sparkle20Regular />}
            disabled={!hasIntent || busy}
            onClick={onOptimize}
          >
            优化提示词
          </Button>
        )}

        <Button
          icon={<Copy20Regular />}
          disabled={busy}
          onClick={onCopy}
        >
          一键复制
        </Button>
      </div>
    </div>
  )
}
