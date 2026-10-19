import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { useStore } from './store'
import { useKeyboard } from './useKeyboard'
import { useDraftPersistence } from './useDraft'
import { useFileDrop } from './useFileDrop'
import { useCopy } from './useCopy'
import { useTidy } from './useLlmRun'
import { useOptimize } from './useOptimize'
import { useTheme, type ThemeMode } from './useTheme'
import { ClarifyPanel } from './components/ClarifyPanel'
import { buildStatusText } from '../shared/statusText'
import { TopBar, addPathsToDraft } from './components/TopBar'
import { ResourceBar } from './components/ResourceBar'
import { EditorArea } from './components/EditorArea'
import { BottomBar } from './components/BottomBar'
import { NoticeBar } from './components/NoticeBar'
import { CopyIssuesDialog } from './components/CopyIssuesDialog'
import { UploadListDialog } from './components/UploadListDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { PromptLibraryDialog } from './components/PromptLibraryDialog'
import { PromptContextBar } from './components/PromptContextBar'
import {
  normalizePromptTitle,
  promptSelectionFrom,
  type PromptLibraryItem,
  type PromptUsageMode
} from '../shared/promptLibrary'

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1
  }
})

export default function App(): JSX.Element {
  const styles = useStyles()
  const setNotice = useStore((s) => s.setNotice)
  const draft = useStore((s) => s.draft)
  const activePrompt = useStore((s) => s.activePrompt)
  const [dragging, setDragging] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  // 状态条要不要显示 Token 用量（设置 → 通用）
  const [showTokenUsage, setShowTokenUsage] = useState(true)

  // 读取主题设置；设置窗口改主题后会广播事件
  useEffect(() => {
    const load = (): void => {
      void window.preface.getSettings().then((s) => {
        setThemeMode(s.theme)
        setShowTokenUsage(s.showTokenUsage)
      })
    }
    load()
    window.addEventListener('preface:theme-changed', load)
    window.addEventListener('preface:settings-changed', load)
    return () => {
      window.removeEventListener('preface:theme-changed', load)
      window.removeEventListener('preface:settings-changed', load)
    }
  }, [])

  const { theme, isDark } = useTheme(themeMode)

  // 草稿的自动保存与恢复
  useDraftPersistence()

  // 草稿代数变化（清空、恢复历史、撤销清空、换新）时丢弃当前优化会话，
  // 并停掉在途请求，避免旧结果写进新草稿或继续消耗额度。
  const draftEpoch = useStore((s) => s.draftEpoch)

  // 一键复制的完整流程
  const { copy, copyState, confirmCopy, cancelCopy, closeUploadList } = useCopy()

  // 整理碎碎念
  const tidy = useTidy()

  // 一键优化
  const optimize = useOptimize()

  // 草稿被替换时丢弃旧会话
  useEffect(() => {
    optimize.reset()
    // optimize.reset 是稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftEpoch])

  // 主进程事件：快捷键换过、打开设置
  useEffect(() => {
    const unsubShortcut = window.preface.onShortcutChanged(({ from, to }) => {
      setNotice({
        kind: 'warning',
        text: `快捷键 ${from} 已被占用，已自动改用 ${to}。可以在设置里修改。`
      })
    })
    const unsubSettings = window.preface.onOpenSettings(() => setSettingsOpen(true))
    return () => {
      unsubShortcut()
      unsubSettings()
    }
  }, [setNotice])

  // 整个窗口支持拖入文件
  const handleDrop = useCallback((paths: string[]) => {
    setDragging(false)
    void addPathsToDraft(paths)
  }, [])
  useFileDrop(handleDrop)

  // 拖拽时显示一层提示
  useEffect(() => {
    const enter = (event: DragEvent): void => {
      if (event.dataTransfer?.types.includes('Files')) setDragging(true)
    }
    const leave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDragging(false)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
    }
  }, [])

  // Esc：先关面板，都没有时隐藏窗口
  const handleEscape = useCallback(() => {
    // Prompt 库自己处理 Esc（可能还要问是否保存），这里不要抢
    if (promptLibraryOpen) return
    if (settingsOpen) {
      setSettingsOpen(false)
      return
    }
    if (copyState.issues.length > 0 || copyState.showUploadList) return
    void window.preface.hideWindow()
  }, [copyState.issues.length, copyState.showUploadList, promptLibraryOpen, settingsOpen])

  const handleOptimize = useCallback(() => {
    void optimize.optimize()
  }, [optimize])

  /**
   * 清空前把草稿存进"上一次的内容"，这样 10 秒后仍能找回。
   * 同时刷新界面上的 previous，让恢复入口立刻可用。
   */
  const handleArchiveDraft = useCallback((snapshot: typeof draft) => {
    void (async () => {
      await window.preface.archiveDraft(snapshot)
      const previous = await window.preface.loadPreviousDraft()
      if (previous) useStore.getState().setPrevious(previous)
    })()
  }, [])

  // 整理和优化同时只会有一个在跑
  const runningKind = tidy.running
    ? ('tidy' as const)
    : optimize.state.phase === 'analyzing' || optimize.state.phase === 'streaming'
      ? ('optimize' as const)
      : optimize.state.phase === 'remedying'
        ? ('followup' as const)
        : null

  /**
   * 优化是否仍在进行。
   *
   * 等待澄清也属于进行中：这时改「下次优化」的选择，不能影响这一轮。
   * 不能用 activePrompt !== null 代替 —— 它只表示本轮用过 Prompt，
   * 请求结束后仍然留着。
   */
  const optimizeRunning =
    optimize.state.phase === 'analyzing' ||
    optimize.state.phase === 'streaming' ||
    optimize.state.phase === 'remedying' ||
    optimize.state.phase === 'waiting-clarify'

  // 优化进行中时显示流式内容，否则显示整理的内容
  const streamText = tidy.running ? tidy.streamText : optimize.streamText

  // 结果状态条
  const statusText = buildStatusText({
    resolvedMode: optimize.state.resolvedMode,
    mode: draft.mode,
    usage: optimize.state.usage,
    sawReasoning: optimize.state.sawReasoning,
    showTokenUsage
  })

  /**
   * 把库里的 Prompt 追加到原文末尾。
   *
   * 只整理首尾空白、保留正文内部格式；追加后切到原文页、标记已有结果过期。
   * 不自动选为模板、不调用模型、不新增语料编号。
   */
  const handleAppendPrompt = useCallback((item: PromptLibraryItem) => {
    const state = useStore.getState()
    state.appendIntentText(item.content)
    state.setActiveTab('source')
    state.setNotice({
      kind: 'success',
      text: `已把「${normalizePromptTitle(item.title)}」追加到原文末尾。`
    })
  }, [])

  /**
   * 设为优化时使用的 Prompt：只记选择，不立刻发请求、不改原文。
   *
   * 空闲时选好，点「优化提示词」就会用它；只有这一轮已经开始、
   * 快照已经冻结时，才需要说「从下次优化起生效」。
   */
  const handleUsePrompt = useCallback(
    (item: PromptLibraryItem, mode: PromptUsageMode) => {
      const state = useStore.getState()
      state.setPromptSelection(promptSelectionFrom(item, mode))
      const title = normalizePromptTitle(item.title)
      state.setNotice({
        kind: 'info',
        text: optimizeRunning
          ? `这一轮已经开始，下次优化起使用「${title}」。`
          : `优化时将使用「${title}」。`
      })
    },
    [optimizeRunning]
  )

  // 弹窗打开时暂停主窗口的优化/复制快捷键，避免误触
  useKeyboard({
    onOptimize: runningKind || promptLibraryOpen ? null : handleOptimize,
    onCopy: runningKind || promptLibraryOpen ? null : () => void copy(),
    onEscape: handleEscape
  })

  return (
    <FluentProvider theme={theme}>
      <div className={styles.root}>
        <TopBar onOpenSettings={() => setSettingsOpen(true)} />
        <ResourceBar />
        <NoticeBar />
        <EditorArea
          streamText={streamText}
          optimizing={
            optimize.state.phase === 'analyzing' ||
            optimize.state.phase === 'streaming' ||
            optimize.state.phase === 'remedying'
          }
          statusText={statusText}
          stale={draft.result?.stale === true}
          refWarning={optimize.state.refWarning}
          commandWarning={optimize.state.commandWarning}
          onReoptimize={handleOptimize}
          onSwitchMode={
            // 完整模板套用时模板格式优先，不提供切换简单/Markdown
            optimize.state.resolvedMode && activePrompt?.mode !== 'template'
              ? optimize.switchMode
              : undefined
          }
          onArchiveDraft={handleArchiveDraft}
          isDark={isDark}
          promptContext={
            <PromptContextBar
              selection={draft.promptSelection}
              activePrompt={activePrompt}
              running={optimizeRunning}
              onOpenLibrary={() => setPromptLibraryOpen(true)}
              onRemove={() => useStore.getState().setPromptSelection(null)}
            />
          }
        />
        <BottomBar
          onTidy={() => void tidy.tidy()}
          onOptimize={handleOptimize}
          onCopy={() => void copy()}
          runningKind={runningKind}
          onCancel={runningKind === 'tidy' ? tidy.cancel : optimize.cancel}
          canUndoTidy={tidy.canUndo}
          onUndoTidy={tidy.undo}
          onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
        />

        {dragging && <DropOverlay />}

        {optimize.state.phase === 'waiting-clarify' && optimize.state.questions.length > 0 && (
          <ClarifyPanel
            intent={optimize.state.intent}
            questions={optimize.state.questions}
            onSubmit={(answers, correction) =>
              void optimize.submitAnswers(answers, correction)
            }
            onCancel={optimize.reset}
          />
        )}
      </div>

      <CopyIssuesDialog
        open={copyState.issues.length > 0}
        issues={copyState.issues}
        onCancel={cancelCopy}
        onConfirm={(include) => void confirmCopy(include)}
      />

      <UploadListDialog
        open={copyState.showUploadList}
        files={copyState.pendingUploads}
        onClose={closeUploadList}
      />

      {/* 结果被编辑过时，覆盖前先确认 */}
      <Dialog
        open={optimize.pendingConfirm !== null}
        onOpenChange={(_, d) => !d.open && optimize.cancelOverwrite()}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>将覆盖你的修改</DialogTitle>
            <DialogContent>
              你在优化结果里做过手动修改。继续的话，这些修改会被新的结果覆盖。确定吗？
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={optimize.cancelOverwrite}>
                取消
              </Button>
              <Button appearance="primary" onClick={optimize.confirmOverwrite}>
                覆盖
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 整理结果丢了 /命令：覆盖原文前先问一句 */}
      <Dialog
        open={tidy.pendingCommand !== null}
        onOpenChange={(_, d) => !d.open && tidy.cancelReplace()}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>整理结果里缺少命令</DialogTitle>
            <DialogContent>
              原文里的 {tidy.pendingCommand?.missing.join('、')} 没有出现在整理结果里。
              如果直接替换，这些命令就没法执行了。
              <br />
              可以点「取消」保留原文，手动把命令补进结果后再试。
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={tidy.cancelReplace}>
                取消
              </Button>
              <Button appearance="primary" onClick={tidy.confirmReplace}>
                仍然替换
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <PromptLibraryDialog
        open={promptLibraryOpen}
        onClose={() => setPromptLibraryOpen(false)}
        onAppend={handleAppendPrompt}
        onUse={handleUsePrompt}
        busy={runningKind !== null}
      />

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </FluentProvider>
  )
}

function DropOverlay(): JSX.Element {
  // 颜色写在 index.css 的 .drop-overlay 里，深浅色各一套
  return <div className="drop-overlay">松开鼠标，把文件加进来</div>
}
