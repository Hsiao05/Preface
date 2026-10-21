import type { JSX } from 'react'
import { Button, makeStyles, tokens, Tooltip, ToggleButton } from '@fluentui/react-components'
import {
  Copy20Regular,
  Sparkle20Regular,
  TextBulletListSquare20Regular,
  ArrowUndo20Regular,
  Dismiss20Regular,
  Library20Regular,
  Edit20Regular
} from '@fluentui/react-icons'
import { useStore } from '../store'
import { useT } from '../i18n'
import type { Mode } from '../../shared/types'

/**
 * 底栏只放执行动作和模式设置。
 *
 * Prompt 的使用状态放在编辑区工具行（PromptContextBar），
 * 因为它的标题长度不可控，留在这里会挤占按钮宽度。
 */

const NARROW = '@media (max-width: 839px)'

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
  /**
   * 动作行。
   *
   * 宽窗口是一行：撤销／整理、优化表达 / 弹性空隙 / 库、优化、复制。
   * 窄窗口改成两列网格：撤销独占一行，其余两两排列，复制独占一行。
   * 不用 flex-wrap 自然折行 —— 按钮被压窄会逐字换行。
   */
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    [NARROW]: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr'
    }
  },
  group: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    [NARROW]: {
      // 窄窗口拆开分组，让按钮直接落进两列网格
      display: 'contents'
    }
  },
  spacer: {
    flex: 1,
    [NARROW]: {
      display: 'none'
    }
  },
  /**
   * 撤销的容器。
   * 宽窗口用 display:contents 让它不参与布局；窄窗口才变成独占一行的网格项。
   */
  undoSlot: {
    display: 'contents',
    [NARROW]: {
      display: 'flex',
      gridColumn: '1 / -1',
      justifyContent: 'flex-end'
    }
  },
  /** 复制独占窄窗口最后一行 */
  copySlot: {
    display: 'contents',
    [NARROW]: {
      display: 'flex',
      gridColumn: '1 / -1'
    }
  },
  button: {
    whiteSpace: 'nowrap',
    flexShrink: 0,
    [NARROW]: {
      width: '100%'
    }
  },
  /** 撤销是轻量操作，窄窗口也不占满整行 */
  undoButton: {
    whiteSpace: 'nowrap',
    flexShrink: 0,
    width: 'auto'
  }
})

interface Props {
  onTidy: () => void
  onImprove: () => void
  onOptimize: () => void
  onCopy: () => void
  /** 正在进行的调用类型，null 表示空闲 */
  runningKind:
    | 'tidy'
    | 'expression'
    | 'optimize'
    | 'followup'
    | 'translate'
    | 'title'
    | null
  onCancel: () => void
  /** 刚完成一次整理或优化表达，可以撤销 */
  canUndoText: boolean
  undoTextLabel: string
  onUndoText: () => void
  /** 打开「我的 Prompt 库」 */
  onOpenPromptLibrary: () => void
}

export function BottomBar({
  onTidy,
  onImprove,
  onOptimize,
  onCopy,
  runningKind,
  onCancel,
  canUndoText,
  undoTextLabel,
  onUndoText,
  onOpenPromptLibrary
}: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const { draft, setMode } = useStore()

  const hasIntent = draft.intentText.trim().length > 0
  const busy = runningKind !== null
  const transforming = runningKind === 'tidy' || runningKind === 'expression'

  // 完整模板套用时模板正文格式优先，模式控件保留原设置但禁用
  const templateMode = draft.promptSelection?.mode === 'template'
  const modeDisabled = busy || templateMode
  const modeHint = templateMode
    ? t('bottomBar.modeTemplateHint')
    : transforming
      ? t('bottomBar.modeTidyHint')
      : t('bottomBar.modeHint')

  const modes: Array<{ value: Mode; label: string }> = [
    { value: 'markdown', label: t('bottomBar.modeMarkdown') },
    { value: 'auto', label: t('bottomBar.modeAuto') },
    { value: 'simple', label: t('bottomBar.modeSimple') }
  ]

  return (
    <div className={styles.bar}>
      <div className={styles.modeRow}>
        <Tooltip content={modeHint} relationship="description">
          <div className={styles.modeGroup} aria-describedby="mode-hint">
            {modes.map((mode) => (
              <ToggleButton
                key={mode.value}
                size="small"
                appearance="subtle"
                checked={draft.mode === mode.value}
                disabled={modeDisabled}
                onClick={() => setMode(mode.value)}
              >
                {mode.label}
              </ToggleButton>
            ))}
          </div>
        </Tooltip>
        {/* 模式组可被读屏关联的说明；视觉上不重复显示 */}
        <span id="mode-hint" style={{ display: 'none' }}>
          {modeHint}
        </span>
      </div>

      <div className={styles.actions}>
        {canUndoText && !busy && (
          <div className={styles.undoSlot}>
            <Button
              className={styles.undoButton}
              icon={<ArrowUndo20Regular />}
              appearance="subtle"
              onClick={onUndoText}
            >
              {undoTextLabel}
            </Button>
          </div>
        )}

        {transforming ? (
          <Button className={styles.button} icon={<Dismiss20Regular />} onClick={onCancel}>
            {t('bottomBar.cancel')}
          </Button>
        ) : (
          <>
            <Button
              className={styles.button}
              icon={<TextBulletListSquare20Regular />}
              disabled={!hasIntent || busy}
              onClick={onTidy}
            >
              {t('bottomBar.tidy')}
            </Button>
            <Button
              className={styles.button}
              icon={<Edit20Regular />}
              disabled={!hasIntent || busy}
              onClick={onImprove}
            >
              {t('bottomBar.improve')}
            </Button>
          </>
        )}

        <div className={styles.spacer} />

        <div className={styles.group}>
          <Button
            className={styles.button}
            icon={<Library20Regular />}
            // 运行中也可以打开：只读查看、编辑库、设置下一次优化，不启动冲突请求
            onClick={onOpenPromptLibrary}
          >
            {t('bottomBar.library')}
          </Button>

          {runningKind === 'optimize' || runningKind === 'followup' ? (
            <Button
              className={styles.button}
              appearance="primary"
              icon={<Dismiss20Regular />}
              onClick={onCancel}
            >
              {t('bottomBar.cancel')}
            </Button>
          ) : (
            <Button
              className={styles.button}
              appearance="primary"
              icon={<Sparkle20Regular />}
              disabled={!hasIntent || busy}
              onClick={onOptimize}
            >
              {t('bottomBar.optimize')}
            </Button>
          )}

          <div className={styles.copySlot}>
            <Button
              className={styles.button}
              icon={<Copy20Regular />}
              disabled={busy}
              onClick={onCopy}
            >
              {t('bottomBar.copy')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
