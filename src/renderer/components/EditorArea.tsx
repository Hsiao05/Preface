import { useEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react'
import { Button, makeStyles, tokens, Tab, TabList } from '@fluentui/react-components'
import { ArrowUndo20Regular, Dismiss20Regular, Translate20Regular } from '@fluentui/react-icons'
import { useStore } from '../store'
import { IntentEditor, type IntentEditorHandle } from './IntentEditor'
import { MicButton } from './MicButton'
import { useVoiceInput } from '../useVoiceInput'
import { ClearButton } from './ClearButton'
import { useT } from '../i18n'
import { findRefs } from '../../shared/refs'
import type { Draft } from '../../shared/types'

const useStyles = makeStyles({
  area: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0
  },
  tabRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '0 12px 0 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    // 窄窗口时让 Prompt 状态独占第二行，而不是把标签和清空挤变形
    flexWrap: 'wrap',
    '@media (max-width: 759px)': {
      paddingTop: '4px'
    }
  },
  tabActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    flexShrink: 0,
    marginLeft: 'auto'
  },
  /** 编辑工具行里的 Prompt 状态，宽度不够时整块换到下一行 */
  promptSlot: {
    flexShrink: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    '@media (max-width: 759px)': {
      order: 3,
      width: '100%',
      maxWidth: '100%',
      paddingBottom: '4px'
    }
  },
  /** 窄窗口下状态条自己占满第二行 */
  promptSlotInner: {
    minWidth: 0,
    maxWidth: '100%'
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    padding: '8px 12px 12px'
  },
  /** 编辑器区域：相对定位，让麦克风按钮能浮在右下角 */
  editorWrap: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    display: 'flex'
  },
  /** 翻译按钮浮在编辑框左下角，右侧给麦克风留空间 */
  translateSlot: {
    position: 'absolute',
    left: '10px',
    bottom: '8px',
    maxWidth: 'calc(100% - 64px)',
    zIndex: 2
  },
  translateButton: {
    maxWidth: '100%',
    minWidth: 0,
    whiteSpace: 'nowrap',
    // 按钮浮在文字上方，必须是实心底色，否则下面的正文会透出来和标签叠在一起。
    // 颜色与编辑框一致，看起来仍像浮在页面上，而不是多出一块补丁。
    backgroundColor: tokens.colorNeutralBackground3,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover
    },
    '&:active': {
      backgroundColor: tokens.colorNeutralBackground3Pressed
    },
    '&:disabled': {
      backgroundColor: tokens.colorNeutralBackground3
    }
  },
  translateLabel: {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 2px 8px',
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    /*
     * 固定高度：无论有没有内容、内容多长，都占同样的一行，
     * 这样结果框的大小不会因为状态条出现而变化（这是"跳一下"的原因）。
     *
     * 高度要够放下一行小号按钮（20-24px），所以给 32px。
     * 用 minHeight 而不是 height：文字换行时能撑开，不至于被裁掉。
     */
    minHeight: '32px',
    boxSizing: 'border-box',
    flexShrink: 0
  },
  staleBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    marginBottom: '8px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorPaletteYellowBackground1,
    fontSize: tokens.fontSizeBase200
  },
  resultWrap: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column'
  },
  /*
   * 【结果区容器】
   * 流式输出和输出完共用这一个容器，保证切换时位置和颜色都不变。
   *
   * 三层结构：
   *   resultBox      外层，负责边框、圆角、背景
   *   resultContent  内层，绝对定位撑满，负责内边距和排版
   *   可编辑时里面再放 Fluent 的 Textarea
   *
   * 【关于 Fluent Textarea 的坑】
   * 它渲染成 <span> 包着 <textarea>。把定位和高度写在 Textarea 的
   * className 上只会作用到外层 span，里面那个 textarea 是普通块元素，
   * 不会继承高度，于是塌缩成默认的几行高 —— 这就是"高度没占满"和
   * "输出完跳一下"的原因。所以这里用后代选择器直接管到里面的 textarea。
   */
  resultBox: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: 'hidden'
  },
  /** 流式输出时的只读显示 */
  resultContent: {
    position: 'absolute',
    inset: 0,
    padding: '10px 12px 44px',
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.7',
    fontFamily: tokens.fontFamilyBase,
    color: tokens.colorNeutralForeground1,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  /**
   * 可编辑状态：原生 textarea。
   *
   * 【为什么不用 Fluent 的 Textarea】
   * 它渲染成 <span> 包着 <textarea>，高度和背景要穿透两层才能改，
   * 而且它自带 background-color，会和容器的底色打架（之前"输出完背景变灰"
   * 就是这个原因）。这里只需要 value / onChange / placeholder，
   * 用原生元素最直接，样式完全由我们掌控。
   *
   * 定位和排版与流式状态的 resultContent 完全一致，
   * 所以两种状态互相切换时不会有任何跳动。
   */
  resultEditable: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px 44px',
    margin: 0,
    border: 'none',
    outline: 'none',
    resize: 'none',
    // 透明：让容器的底色透出来，保证和流式状态同一个颜色
    backgroundColor: 'transparent',
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.7',
    fontFamily: tokens.fontFamilyBase,
    color: tokens.colorNeutralForeground1,
    overflowY: 'auto'
  },
  editedMark: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic'
  }
})

interface EditorAreaProps {
  /** 流式收到的文字（整理或优化时实时显示） */
  streamText?: string
  /**
   * 优化正在进行（包括"正在分析"阶段）。
   * 用来让"优化结果"标签在还没出结果时就可点，并把流式内容显示在那里。
   */
  optimizing?: boolean
  /** 结果状态条上的文字 */
  statusText?: string | null
  /** 结果已过期（原文改过了） */
  stale?: boolean
  /** 引用校验没过、补救也没成功时的提示 */
  refWarning?: string | null
  /** 原文里的 /命令 没有原样保留时的提示 */
  commandWarning?: string | null
  /** 重新优化 */
  onReoptimize?: () => void
  /** 切换模式 */
  onSwitchMode?: (target: 'simple' | 'markdown') => void
  /** 清空前归档，供"恢复上一次的内容"使用 */
  onArchiveDraft?: (draft: Draft) => void
  /** 当前是不是深色模式（传给 CodeMirror 换主题） */
  isDark?: boolean
  /**
   * 编辑区工具行里的 Prompt 使用状态。
   * 放在这里而不是底栏，避免可变长标题挤占操作按钮的宽度。
   */
  promptContext?: ReactNode
  /** 是否有模型调用正在进行（含翻译自身） */
  busy?: boolean
  /** 翻译按钮与 5 秒撤销 */
  translation?: {
    targetLabel: string
    runningPane: 'source' | 'result' | null
    undoPane: 'source' | 'result' | null
    undoSeconds: number
    onTranslate: (pane: 'source' | 'result') => void
    onUndo: () => void
    onCancel: () => void
  }
}

export function EditorArea({
  streamText,
  optimizing = false,
  statusText,
  stale,
  refWarning,
  commandWarning,
  onReoptimize,
  onSwitchMode,
  onArchiveDraft,
  isDark = false,
  promptContext,
  busy = false,
  translation
}: EditorAreaProps): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const { draft, activeTab, setActiveTab, setIntentText, setResultText } = useStore()
  const [focusSignal, setFocusSignal] = useState(0)
  const editorRef = useRef<IntentEditorHandle>(null)

  // 语音输入：识别结果插在光标处
  const voice = useVoiceInput((text) => {
    editorRef.current?.insertAtCursor(text)
  })

  const hasResult = Boolean(draft.result?.text)
  // 优化进行中时，结果标签也要可点（这时还没有结果，但流式内容要在那里显示）
  const resultTabEnabled = hasResult || optimizing

  // 主进程要求把光标放进输入框时，切到原文标签并聚焦
  useEffect(() => {
    const unsubscribe = window.preface.onFocusInput(() => {
      setActiveTab('source')
      setFocusSignal((n) => n + 1)
    })
    return unsubscribe
  }, [setActiveTab])

  // @ 补全用的资料列表
  const resources = useMemo(
    () => [
      ...draft.files.map((f) => ({ id: f.id, label: f.name, kind: 'file' as const })),
      ...draft.corpora.map((c) => ({
        id: c.id,
        label: c.title.trim() || t('editor.untitledCorpus'),
        kind: 'corpus' as const
      }))
    ],
    [draft.files, draft.corpora, t]
  )

  // 原文里引用了但已经不存在的编号，显示为失效引用
  const brokenRefs = useMemo(() => {
    const known = new Set(resources.map((r) => r.id))
    const broken = new Set<string>()
    for (const ref of findRefs(draft.intentText)) {
      const id = ref.slice(1)
      if (!known.has(id)) broken.add(id)
    }
    return broken
  }, [draft.intentText, resources])

  // 整理进行中时，把流式收到的内容实时显示出来
  const streaming = Boolean(streamText && streamText.length > 0)

  /** 左下角的翻译 / 取消 / 撤销按钮 */
  const renderTranslateButton = (
    pane: 'source' | 'result',
    extraDisabled = false
  ): JSX.Element | null => {
    if (!translation) return null

    const runningHere = translation.runningPane === pane
    const runningElsewhere =
      translation.runningPane !== null && translation.runningPane !== pane
    const undoHere = translation.undoPane === pane

    if (undoHere) {
      const label = t('editor.undoTranslate', { seconds: translation.undoSeconds })
      return (
        <Button
          className={styles.translateButton}
          size="small"
          appearance="subtle"
          icon={<ArrowUndo20Regular />}
          title={label}
          aria-label={label}
          onClick={translation.onUndo}
        >
          <span className={styles.translateLabel}>{label}</span>
        </Button>
      )
    }

    const label = runningHere
      ? t('editor.cancelTranslate')
      : t('editor.translateTo', { language: translation.targetLabel })

    return (
      <Button
        className={styles.translateButton}
        size="small"
        appearance="subtle"
        icon={runningHere ? <Dismiss20Regular /> : <Translate20Regular />}
        disabled={!runningHere && (busy || runningElsewhere || extraDisabled)}
        title={label}
        aria-label={label}
        onClick={() =>
          runningHere ? translation.onCancel() : translation.onTranslate(pane)
        }
      >
        <span className={styles.translateLabel}>{label}</span>
      </Button>
    )
  }

  return (
    <div className={styles.area}>
      <div className={styles.tabRow}>
        <TabList
          selectedValue={activeTab}
          onTabSelect={(_, data) => setActiveTab(data.value as 'source' | 'result')}
          size="small"
        >
          <Tab value="source">{t('editor.source')}</Tab>
          <Tab value="result" disabled={!resultTabEnabled}>
            {t('editor.result')}
          </Tab>
        </TabList>

        {promptContext && (
          <div className={styles.promptSlot}>
            <div className={styles.promptSlotInner}>{promptContext}</div>
          </div>
        )}

        {/* 靠右对齐的一键清空 */}
        <div className={styles.tabActions}>
          {onArchiveDraft && <ClearButton onArchive={onArchiveDraft} />}
        </div>
      </div>

      <div className={styles.body}>
        {activeTab === 'source' ? (
          <div className={styles.editorWrap}>
            <IntentEditor
              ref={editorRef}
              value={draft.intentText}
              onChange={setIntentText}
              resources={resources}
              brokenRefs={brokenRefs}
              focusSignal={focusSignal}
              isDark={isDark}
            />

            {/* 麦克风按钮浮在右下角。只在原文页显示。 */}
            <MicButton
              state={voice.state}
              elapsed={voice.elapsed}
              level={voice.level}
              disabled={optimizing || busy || (streamText !== undefined && Boolean(streamText))}
              onStart={() => void voice.start()}
              onCancel={voice.cancelTranscribe}
            />

            {translation && (
              <div className={styles.translateSlot}>
                {renderTranslateButton('source', !draft.intentText.trim())}
              </div>
            )}
          </div>
        ) : (
          <div className={styles.resultWrap}>
            {stale && (
              <div className={styles.staleBar}>
                <span>{t('editor.stale')}</span>
                <Button size="small" onClick={onReoptimize}>
                  {t('editor.reoptimize')}
                </Button>
              </div>
            )}

            {/*
              校验提示：引用可能有问题、/命令 没有原样保留。
              只提示，不阻止保存，也不自动再调用模型。
            */}
            {commandWarning && (
              <div className={styles.staleBar}>
                <span>{commandWarning}</span>
              </div>
            )}
            {refWarning && (
              <div className={styles.staleBar}>
                <span>{refWarning}</span>
              </div>
            )}

            {/*
              状态条常驻，不按内容显示/隐藏。
              它原来只在优化完成后才出现，占掉一行高度，把结果框挤矮 ——
              这就是"输出完跳一下、高度没占满"的真正原因。
              这里让它始终占位，高度写死，内容变了也不会改变布局。
            */}
            <div className={styles.statusBar}>
              {statusText && <span>{statusText}</span>}
              {draft.result?.editedByUser && (
                <span className={styles.editedMark}>{t('editor.editedByUser')}</span>
              )}
              {onSwitchMode && hasResult && (
                <Button
                  size="small"
                  appearance="subtle"
                  onClick={() =>
                    onSwitchMode(draft.optimization?.resolvedMode === 'simple' ? 'markdown' : 'simple')
                  }
                >
                  {draft.optimization?.resolvedMode === 'simple'
                    ? t('editor.switchToMarkdown')
                    : t('editor.switchToSimple')}
                </Button>
              )}
            </div>

            {/* 流式和可编辑共用同一个容器，切换时不会跳动 */}
            <div className={styles.resultBox}>
              {optimizing && !hasResult ? (
                <div className={styles.resultContent}>{streamText || t('editor.analyzing')}</div>
              ) : streaming ? (
                <div className={styles.resultContent}>{streamText}</div>
              ) : (
                <textarea
                  className={styles.resultEditable}
                  value={draft.result?.text ?? ''}
                  onChange={(event) => setResultText(event.target.value)}
                  placeholder={t('editor.resultPlaceholder')}
                  spellCheck={false}
                />
              )}

              {translation && hasResult && !optimizing && !streaming && (
                <div className={styles.translateSlot}>
                  {renderTranslateButton('result')}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
