import { type JSX } from 'react'
import { Tooltip, makeStyles, tokens } from '@fluentui/react-components'
import { Mic20Regular, Dismiss16Regular } from '@fluentui/react-icons'
import { formatDuration } from '../recorder'
import { useT } from '../i18n'
import type { VoiceState } from '../useVoiceInput'

/**
 * 麦克风按钮。
 *
 * 浮在原文输入框的右下角（输入框底部留了内边距，不会盖住文字）。
 *
 * 三种状态：
 *   空闲    灰色麦克风图标
 *   录音中  红色图标 + 呼吸动画 + 计时 + 音量跳动条
 *   识别中  转圈 + "识别中…"，点击可取消
 */

const useStyles = makeStyles({
  wrap: {
    position: 'absolute',
    right: '10px',
    bottom: '10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    zIndex: 5,
    // 浮在输入框上方，但不要挡到点击（下面的容器会自己处理）
    pointerEvents: 'auto'
  },
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    borderRadius: '16px',
    border: 'none',
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    transition: 'background-color 120ms, color 120ms',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover,
      color: tokens.colorNeutralForeground1
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.5
    }
  },
  /** 录音中：红色 + 呼吸动画 */
  recording: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    '&:hover': {
      backgroundColor: tokens.colorPaletteRedBackground2,
      color: tokens.colorPaletteRedForeground1
    },
    animationName: {
      '0%': { opacity: 1 },
      '50%': { opacity: 0.55 },
      '100%': { opacity: 1 }
    },
    animationDuration: '1.4s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'ease-in-out'
  },
  timer: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap'
  },
  /** 音量跳动条 */
  meter: {
    display: 'inline-flex',
    alignItems: 'flex-end',
    gap: '2px',
    height: '14px'
  },
  bar: {
    width: '3px',
    borderRadius: '1px',
    backgroundColor: tokens.colorPaletteRedForeground1,
    transition: 'height 80ms linear'
  },
  /** 识别中的转圈 */
  spinner: {
    width: '14px',
    height: '14px',
    border: `2px solid ${tokens.colorNeutralStroke2}`,
    borderTopColor: tokens.colorBrandForeground1,
    borderRadius: '50%',
    animationName: {
      '0%': { transform: 'rotate(0deg)' },
      '100%': { transform: 'rotate(360deg)' }
    },
    animationDuration: '0.8s',
    animationIterationCount: 'infinite',
    animationTimingFunction: 'linear'
  }
})

interface Props {
  state: VoiceState
  elapsed: number
  level: number
  /** 整理或优化进行中时不可用 */
  disabled: boolean
  onStart: () => void
  onCancel: () => void
}

/** 音量条有几根 */
const BAR_COUNT = 4

export function MicButton({ state, elapsed, level, disabled, onStart, onCancel }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()

  // ---------- 识别中 ----------
  if (state === 'transcribing') {
    return (
      <div className={styles.wrap}>
        <Tooltip content={t('mic.cancelTranscribe')} relationship="label">
          <button className={styles.button} onClick={onCancel} type="button">
            <span className={styles.spinner} />
            <span>{t('mic.transcribing')}</span>
            <Dismiss16Regular />
          </button>
        </Tooltip>
      </div>
    )
  }

  // ---------- 录音中 ----------
  if (state === 'recording') {
    return (
      <div className={styles.wrap}>
        <button className={`${styles.button} ${styles.recording}`} type="button" disabled>
          <Mic20Regular />
          <span className={styles.timer}>{formatDuration(elapsed)}</span>

          {/* 音量跳动条：每根的高度按当前音量算，错开一点更好看 */}
          <span className={styles.meter}>
            {Array.from({ length: BAR_COUNT }, (_, i) => {
              const factor = 0.4 + (i / BAR_COUNT) * 0.6
              const height = Math.max(3, Math.round(level * 14 * factor))
              return (
                <span
                  key={i}
                  className={styles.bar}
                  style={{ height: `${height}px` }}
                />
              )
            })}
          </span>
        </button>
      </div>
    )
  }

  // ---------- 空闲 ----------
  return (
    <div className={styles.wrap}>
      <Tooltip
        content={t('mic.tooltip')}
        relationship="label"
      >
        <button
          className={styles.button}
          type="button"
          disabled={disabled}
          onClick={onStart}
        >
          <Mic20Regular />
        </button>
      </Tooltip>
    </div>
  )
}
