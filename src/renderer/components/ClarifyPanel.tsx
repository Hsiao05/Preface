import { useState, type JSX } from 'react'
import {
  Button,
  Input,
  Radio,
  Text,
  Textarea,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { Edit16Regular } from '@fluentui/react-icons'
import type { ParsedQuestion } from '../../shared/parseReply'
import type { ClarifyAnswer } from '../../shared/conversation'

/**
 * 澄清面板（文档第三节）。
 *
 * 从底部滑出，覆盖编辑区，不另开弹窗。
 *
 * 【布局要求】
 * - 每张问题卡片的高度由内容决定，选项多也不会被截断
 * - 整个列表可以上下滚动，不把所有问题挤在一屏里
 * - 每题最后两项固定是「让 AI 自己判断」和「写下自己的答案」（后者带输入框）
 */

const useStyles = makeStyles({
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    flexDirection: 'column',
    zIndex: 20,
    // 面板本身不滚动，只有中间的列表滚动
    overflow: 'hidden'
  },
  header: {
    padding: '12px 14px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0
  },
  intentRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px'
  },
  intentLabel: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    whiteSpace: 'nowrap',
    paddingTop: '2px'
  },
  intentText: {
    flex: 1,
    lineHeight: '1.6',
    fontSize: tokens.fontSizeBase300,
    wordBreak: 'break-word'
  },
  correctionBox: {
    marginTop: '8px',
    // 全宽，让用户能看全自己写的内容
    display: 'block',
    width: '100%',
    '& textarea': {
      width: '100%',
      minHeight: '64px',
      lineHeight: '1.6'
    }
  },
  // 这一层负责滚动
  scroller: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    '&::-webkit-scrollbar': { width: '8px' },
    '&::-webkit-scrollbar-thumb': {
      backgroundColor: tokens.colorNeutralStroke1,
      borderRadius: '4px'
    }
  },
  card: {
    // 高度由内容决定，不设固定值
    padding: '12px 14px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    flexShrink: 0
  },
  question: {
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: '10px',
    lineHeight: '1.6',
    display: 'block'
  },
  options: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  // 最后两项用分隔线隔开，让它们看起来是"固定选项"
  fixedGroup: {
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: `1px dashed ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  customInput: {
    marginTop: '6px',
    marginLeft: '26px'
  },
  footer: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '12px 14px',
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    flexShrink: 0
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0
  }
})

interface Props {
  intent: string | null
  questions: ParsedQuestion[]
  onSubmit: (answers: Record<string, ClarifyAnswer>, intentCorrection: string | null) => void
  onCancel: () => void
}

/** 每道题的作答状态 */
interface QuestionState {
  /** 选中的选项文字，null 表示没选 */
  chosen: string | null
  /** 交给了 AI 自行判断 */
  delegated: boolean
  /** 用户自己写的答案 */
  custom: string
  /** 选中了"写下自己的答案" */
  customChosen: boolean
}

const EMPTY_STATE: QuestionState = {
  chosen: null,
  delegated: false,
  custom: '',
  customChosen: false
}

const DELEGATE_VALUE = '__delegate__'
const CUSTOM_VALUE = '__custom__'

export function ClarifyPanel({ intent, questions, onSubmit, onCancel }: Props): JSX.Element {
  const styles = useStyles()
  const [states, setStates] = useState<Record<number, QuestionState>>({})
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [correction, setCorrection] = useState('')

  const stateOf = (no: number): QuestionState => states[no] ?? EMPTY_STATE

  const update = (no: number, patch: Partial<QuestionState>): void => {
    setStates((prev) => ({ ...prev, [no]: { ...stateOf(no), ...patch } }))
  }

  /** 单选：三选一互斥 */
  const select = (no: number, value: string): void => {
    if (value === DELEGATE_VALUE) {
      update(no, { delegated: true, chosen: null, customChosen: false })
    } else if (value === CUSTOM_VALUE) {
      update(no, { customChosen: true, chosen: null, delegated: false })
    } else {
      update(no, { chosen: value, delegated: false, customChosen: false })
    }
  }

  /** 收集答案：未作答的问题不放进结果里 */
  const collect = (): Record<string, ClarifyAnswer> => {
    const answers: Record<string, ClarifyAnswer> = {}

    for (const question of questions) {
      const s = stateOf(question.no)

      if (s.customChosen && s.custom.trim()) {
        answers[String(question.no)] = { state: 'custom', value: s.custom.trim() }
      } else if (s.delegated) {
        answers[String(question.no)] = { state: 'delegated', value: '' }
      } else if (s.chosen !== null) {
        answers[String(question.no)] = { state: 'chosen', value: s.chosen }
      }
      // 未作答：不放进 answers
    }

    return answers
  }

  const handleContinue = (): void => {
    onSubmit(collect(), correction.trim() || null)
  }

  const handleSkip = (): void => {
    // 跳过：所有问题都不作答
    onSubmit({}, correction.trim() || null)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div className={styles.intentRow}>
          <span className={styles.intentLabel}>我理解你想要：</span>
          <span className={styles.intentText}>{intent || '（模型没有复述意图）'}</span>
          <Button
            size="small"
            appearance="subtle"
            icon={<Edit16Regular />}
            onClick={() => setCorrectionOpen((v) => !v)}
          >
            不对，我来更正
          </Button>
        </div>

        {correctionOpen && (
          <Textarea
            className={styles.correctionBox}
            value={correction}
            onChange={(_, d) => setCorrection(d.value)}
            placeholder="说清你真正想要什么。可以写多行，写完点下面的「继续优化」或「跳过，直接优化」。"
            resize="vertical"
            rows={3}
            autoFocus
          />
        )}
      </div>

      {/* 这一层滚动，问题再多也能看全 */}
      <div className={styles.scroller}>
        {questions.map((question) => {
          const s = stateOf(question.no)
          return (
            <div key={question.no} className={styles.card}>
              <Text className={styles.question}>
                {question.no}. {question.question}
              </Text>

              {/* 模型给的选项 */}
              <div className={styles.options}>
                {question.options.map((option) => (
                  <Radio
                    key={option}
                    checked={s.chosen === option}
                    label={option}
                    onChange={() => select(question.no, option)}
                  />
                ))}
              </div>

              {/* 固定两项：交给 AI / 自己写 */}
              <div className={styles.fixedGroup}>
                <Radio
                  checked={s.delegated}
                  label="让 AI 自己判断"
                  onChange={() => select(question.no, DELEGATE_VALUE)}
                />
                <Radio
                  checked={s.customChosen}
                  label="写下自己的答案"
                  onChange={() => select(question.no, CUSTOM_VALUE)}
                />
                {s.customChosen && (
                  <Input
                    className={styles.customInput}
                    value={s.custom}
                    onChange={(_, d) => update(question.no, { custom: d.value })}
                    placeholder="在这里写下你的答案"
                    autoFocus
                  />
                )}
              </div>
            </div>
          )
        })}

        <Text className={styles.hint}>每题最多选一项，也可以不选。不选的题目不会写进提示词。</Text>
      </div>

      <div className={styles.footer}>
        <Button appearance="secondary" onClick={handleSkip}>
          跳过，直接优化
        </Button>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button appearance="subtle" onClick={onCancel}>
            取消
          </Button>
          <Button appearance="primary" onClick={handleContinue}>
            继续优化
          </Button>
        </div>
      </div>
    </div>
  )
}
