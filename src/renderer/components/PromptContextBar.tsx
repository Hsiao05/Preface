import { useRef, type JSX } from 'react'
import { Button, makeStyles, tokens, Tooltip } from '@fluentui/react-components'
import { Dismiss16Regular, Info16Regular } from '@fluentui/react-icons'
import {
  PROMPT_MODE_LABELS,
  normalizePromptTitle,
  samePromptSelection,
  type PromptSelection
} from '../../shared/promptLibrary'

/**
 * 编辑区工具行里的 Prompt 使用状态。
 *
 * 空闲时它表示「点优化时就会用它」，所以文案是「优化时使用」，不能写成
 * 「下次优化」——那会让人以为这一次会被跳过。只有一轮优化已经开始、
 * 当前快照已冻结时，改动才真的属于下一轮。
 */

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    minWidth: 0,
    maxWidth: '520px',
    padding: '1px 2px 1px 8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2
  },
  prefix: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3
  },
  title: {
    flex: '0 1 auto',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground1
  },
  separator: {
    flexShrink: 0,
    color: tokens.colorNeutralForeground4
  },
  mode: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground3
  },
  button: {
    flexShrink: 0,
    whiteSpace: 'nowrap'
  },
  iconButton: {
    flexShrink: 0,
    minWidth: 'auto'
  }
})

interface Props {
  /** 下一次优化要用的选择（草稿里的快照） */
  selection: PromptSelection | null
  /** 当前这一轮实际使用的快照；只用于判断「已移除」是否仍要显示 */
  activePrompt: PromptSelection | null
  /** 优化是否仍在进行（含等待澄清） */
  running: boolean
  onOpenLibrary: () => void
  onRemove: () => void
}

function buildHelp(
  selection: PromptSelection | null,
  activePrompt: PromptSelection | null,
  running: boolean
): string {
  const parts: string[] = []

  if (selection) {
    parts.push(`完整标题：${normalizePromptTitle(selection.title)}`)
    parts.push(
      selection.mode === 'reference'
        ? '参考结构和表达：只借鉴章节、步骤、语气和详略，任务内容以原文为准。'
        : '完整模板套用：保留模板的章节顺序、固定文案和格式，用原文和澄清回答填入任务部分。'
    )
    if (selection.mode === 'template') {
      parts.push(
        '完整模板套用时按模板正文格式输出，下方模式设置暂不生效；移除模板后恢复，原设置不会改变。'
      )
    }
  } else if (running && activePrompt) {
    parts.push('下一次点「优化提示词」时不会使用 Prompt。')
  }

  if (running) {
    // 这一轮已经冻结了快照，改动只能等下一轮
    const changed = !samePromptSelection(selection, activePrompt)
    if (changed) {
      parts.push('这一轮已经开始，改动从下一次优化起生效，不会影响当前结果和澄清。')
    } else {
      parts.push('当前这一轮正在使用这份 Prompt；改动会从下一次优化起生效。')
    }
  }

  return parts.join('\n')
}

export function PromptContextBar({
  selection,
  activePrompt,
  running,
  onOpenLibrary,
  onRemove
}: Props): JSX.Element | null {
  const styles = useStyles()
  const changeRef = useRef<HTMLButtonElement>(null)

  // 没有下一次选择、也没有正在进行的运行：整条不显示，不占空行。
  // activePrompt 在请求结束后仍然保留，不能单独作为显示依据。
  if (!selection && !(running && activePrompt)) return null

  const title = selection ? normalizePromptTitle(selection.title) : '不使用 Prompt'
  const mode = selection ? PROMPT_MODE_LABELS[selection.mode] : null
  // 空闲时说「优化时使用」；只有已经开跑、改动要等下一轮时才说「下次优化」
  const prefix = running ? '下次优化：' : '优化时使用：'

  const handleRemove = (): void => {
    const barWillStay = running && activePrompt !== null
    onRemove()
    // 移除按钮会随选择一起消失，把焦点交给仍然存在的控件。
    // 整条都消失时由浏览器把焦点交回文档，不额外抢走编辑区光标。
    requestAnimationFrame(() => {
      if (barWillStay) changeRef.current?.focus()
    })
  }

  return (
    <div className={styles.root} aria-label="Prompt 使用状态">
      <span className={styles.prefix}>{prefix}</span>
      <span className={styles.title}>{title}</span>
      {mode && (
        <>
          <span className={styles.separator} aria-hidden="true">
            ·
          </span>
          <span className={styles.mode}>{mode}</span>
        </>
      )}

      <Tooltip
        content={
          <span style={{ whiteSpace: 'pre-line' }}>
            {buildHelp(selection, activePrompt, running)}
          </span>
        }
        relationship="description"
      >
        <Button
          className={styles.iconButton}
          size="small"
          appearance="subtle"
          icon={<Info16Regular />}
          aria-label="查看 Prompt 使用说明"
        />
      </Tooltip>

      <Button
        ref={changeRef}
        className={styles.button}
        size="small"
        appearance="subtle"
        onClick={onOpenLibrary}
      >
        更换
      </Button>

      {selection && (
        <Tooltip content="移除这份 Prompt" relationship="label">
          <Button
            className={styles.iconButton}
            size="small"
            appearance="subtle"
            icon={<Dismiss16Regular />}
            aria-label="移除这份 Prompt"
            onClick={handleRemove}
          />
        </Tooltip>
      )}
    </div>
  )
}
