import { useEffect, useRef, useState, type JSX } from 'react'
import { Button, Tooltip, makeStyles, tokens } from '@fluentui/react-components'
import { ArrowUndo16Regular, Delete16Regular } from '@fluentui/react-icons'
import { useStore } from '../store'
import type { Draft } from '../../shared/types'

/**
 * 一键清空。
 *
 * 行为（按用户要求）：
 * - 平时是浅灰色无边框的垃圾桶图标，悬停变红并显示提示
 * - 草稿为空时不可点
 * - 点击后直接清空，底部提示"已经清空"
 * - 清空后图标在 10 秒内变成"撤销"，点了能完整恢复
 * - 清空的内容存进历史快照，10 秒后仍可在「设置 → 找回之前的内容」里找到
 */

const useStyles = makeStyles({
  button: {
    color: tokens.colorNeutralForeground4,
    minWidth: 'auto',
    '&:hover': {
      color: tokens.colorPaletteRedForeground1
    }
  },
  undoButton: {
    color: tokens.colorBrandForeground1
  }
})

/** 撤销的有效时间（毫秒） */
const UNDO_WINDOW = 10_000

interface Props {
  /** 清空前先归档，这样"恢复上一次的内容"能找回 */
  onArchive: (draft: Draft) => void
}

export function ClearButton({ onArchive }: Props): JSX.Element {
  const styles = useStyles()
  const draft = useStore((s) => s.draft)
  const clearDraft = useStore((s) => s.clearDraft)
  const setNotice = useStore((s) => s.setNotice)

  /** 保存清空前的草稿，供撤销使用 */
  const [snapshot, setSnapshot] = useState<Draft | null>(null)
  /** 剩余可撤销的秒数，null 表示不在撤销窗口内 */
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 清理计时器
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  /** 草稿是否有内容 */
  const hasContent =
    draft.intentText.trim().length > 0 ||
    draft.files.length > 0 ||
    draft.corpora.length > 0 ||
    Boolean(draft.result?.text)

  const handleClear = (): void => {
    // 1. 先归档 + 存历史快照，这样 10 秒后仍能找回
    onArchive(draft)
    void window.preface.saveSnapshot(draft, 'cleared')

    // 2. 记下快照
    setSnapshot(draft)

    // 3. 清空（保留目标、模式、风格等选择）
    clearDraft()
    setNotice({ kind: 'success', text: '已经清空' })

    // 4. 开始 10 秒倒计时
    setSecondsLeft(UNDO_WINDOW / 1000)
    if (timerRef.current) clearInterval(timerRef.current)

    const startedAt = Date.now()
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt
      const left = Math.ceil((UNDO_WINDOW - elapsed) / 1000)

      if (left <= 0) {
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = null
        setSecondsLeft(null)
        setSnapshot(null)
      } else {
        setSecondsLeft(left)
      }
    }, 250)
  }

  const handleUndo = (): void => {
    if (!snapshot) return

    // 完整恢复
    useStore.getState().setDraft(snapshot)
    setSnapshot(null)
    setSecondsLeft(null)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    setNotice({ kind: 'info', text: '已撤销，内容已恢复。' })
  }

  // 撤销窗口内：显示"撤销"
  if (secondsLeft !== null && snapshot) {
    return (
      <Tooltip content={`恢复清空前的内容（还剩 ${secondsLeft} 秒）`} relationship="label">
        <Button
          className={styles.undoButton}
          appearance="subtle"
          size="small"
          icon={<ArrowUndo16Regular />}
          onClick={handleUndo}
        >
          撤销
        </Button>
      </Tooltip>
    )
  }

  return (
    <Tooltip content="清空原文文件和语料" relationship="label">
      <Button
        className={styles.button}
        appearance="subtle"
        size="small"
        icon={<Delete16Regular />}
        aria-label="清空原文文件和语料"
        disabled={!hasContent}
        onClick={handleClear}
      />
    </Tooltip>
  )
}
