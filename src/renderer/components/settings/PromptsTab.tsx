import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import {
  Add20Regular,
  ArrowReset20Regular,
  Copy20Regular,
  Delete20Regular,
  Eye20Regular,
  Play20Regular,
  Save20Regular
} from '@fluentui/react-icons'
import { useLlmRun } from '../../useLlmRun'
import { parseReply } from '../../../shared/parseReply'
import { buildOptimizeUserMessage } from '../../../shared/buildMessages'
import { formatTokenCount } from '../../../shared/estimateTokens'
import { useStore } from '../../store'
import { estimateTokens } from '../../../shared/estimateTokens'
import { buildSystemPrompt } from '../../../shared/buildMessages'
import { toOverrides } from '../../usePromptOverrides'
import { useT, useUiLanguage } from '../../i18n'
import { formatNumber } from '../../format'
import { displayBuiltinName } from '../../../shared/promptNames'
import type { StyleItemView } from '../../../preload/index'

/**
 * 「提示词与风格」设置页（文档第八节）。
 *
 * 左边是列表，右边是编辑区。
 * 块 5（输出协议）锁定不可改，因为程序依赖它解析模型输出。
 */

const useStyles = makeStyles({
  layout: {
    display: 'flex',
    gap: '12px',
    height: '100%',
    minHeight: 0
  },
  sidebar: {
    width: '220px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    overflowY: 'auto',
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingRight: '8px'
  },
  groupTitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    padding: '8px 8px 4px',
    fontWeight: tokens.fontWeightSemibold
  },
  item: {
    padding: '6px 10px',
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase300,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    '&:hover': { backgroundColor: tokens.colorNeutralBackground3Hover }
  },
  /*
   * 选中态。
   *
   * 【为什么不用 colorBrandBackground2】
   * 它在浅色下是淡蓝、深色下却是很扎眼的亮蓝，和深色模式的整体观感不搭。
   * 改用中性色 + 左侧竖条：深浅两套主题下都是"轻微高亮"的感觉，
   * 不会抢走编辑区的注意力。
   */
  itemActive: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: `inset 3px 0 0 0 ${tokens.colorBrandStroke1}`
  },
  editedMark: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorPaletteYellowForeground1
  },
  editor: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minHeight: 0
  },
  editorTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400
  },
  /*
   * 【编辑框容器】
   * 和主窗口的结果区用同一套做法：外层负责边框、圆角、背景，
   * 内层用绝对定位撑满。
   *
   * 【关于背景色】
   * Fluent 的深色主题里，Background 的数字越小越暗（和浅色主题相反）：
   *   Background1 = #292929（偏灰）
   *   Background3 = #141414（更深）
   * 主窗口的编辑区用的是 Background3，这里保持一致，
   * 否则设置页看起来会比主窗口"灰一档"。
   *
   * 用绝对定位而不是 height: 100% —— 在 flex 容器里百分比高度无效，
   * 父元素的高度是 flex 分配出来的计算值，子元素拿不到。
   */
  textareaBox: {
    flex: 1,
    minHeight: '200px',
    position: 'relative',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: 'hidden'
  },
  /**
   * 原生 textarea。
   *
   * 【为什么必须用原生元素】
   * Fluent 的 Textarea 渲染成 <span> 包着 <textarea>，并且自带
   * background-color。那样即使容器设了深色，里面的 textarea 也会
   * 用自己那层灰背景盖上去 —— 这就是"背景还是灰的"的原因。
   * 原生元素没有这层干扰，背景设成 transparent 就能让容器透出来。
   */
  textarea: {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    margin: 0,
    border: 'none',
    outline: 'none',
    resize: 'none',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '1.6',
    overflowY: 'auto'
  },
  /** 锁定项（输出协议）的只读显示，和上面的容器同样的外观 */
  readonly: {
    position: 'absolute',
    inset: 0,
    padding: '10px 12px',
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    overflowY: 'auto'
  },
  tokenLine: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  },
  tokenWarn: {
    color: tokens.colorPaletteYellowForeground1
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  samples: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  },
  sampleRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start'
  },
  /**
   * 样本输入框。
   * 和主编辑框用同一套外观（原生 textarea + 透明背景），
   * 否则它在深色下也会是灰的。
   */
  sampleInput: {
    flex: 1,
    minHeight: '64px',
    padding: '8px 10px',
    margin: 0,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    outline: 'none',
    resize: 'vertical',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground1,
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '1.6'
  },
  tryArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px dashed ${tokens.colorNeutralStroke2}`
  },
  tryResult: {
    maxHeight: '200px',
    overflowY: 'auto',
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  preview: {
    maxHeight: '400px',
    overflowY: 'auto',
    padding: '12px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase200,
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  }
})

/** 块 5 的 id，锁定不可编辑 */
const LOCKED_BLOCK_ID = 'protocol'

interface Props {
  onNotice: (n: { text: string; kind: 'info' | 'warning' | 'success' } | null) => void
}

export function PromptsTab({ onNotice }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const language = useUiLanguage()
  const [items, setItems] = useState<StyleItemView[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftText, setDraftText] = useState('')
  const [draftSamples, setDraftSamples] = useState<string[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importConflicts, setImportConflicts] = useState<StyleItemView[]>([])

  // 试用区
  const [tryInput, setTryInput] = useState('')
  const [tryOutput, setTryOutput] = useState('')
  const [tryRunning, setTryRunning] = useState(false)
  const [tryUsage, setTryUsage] = useState<string | null>(null)
  const { run } = useLlmRun()

  const reload = useCallback(async (keepId?: string): Promise<void> => {
    const data = await window.preface.listStyles()
    setItems(data.items)

    const id = keepId ?? selectedId ?? data.items[0]?.id ?? null
    setSelectedId(id)

    const item = data.items.find((i) => i.id === id)
    setDraftText(item?.text ?? '')
    setDraftSamples(item?.samples ?? [])
  }, [selectedId])

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selected = useMemo(
    () => items?.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  )

  /** 选中某一项 */
  const select = (item: StyleItemView): void => {
    setSelectedId(item.id)
    setDraftText(item.text)
    setDraftSamples(item.samples ?? [])
  }

  /** 有没有未保存的修改 */
  const dirty = useMemo(() => {
    if (!selected) return false
    if (draftText !== selected.text) return true
    const a = JSON.stringify(draftSamples)
    const b = JSON.stringify(selected.samples ?? [])
    return a !== b
  }, [selected, draftText, draftSamples])

  /** 内置项按当前界面语言显示，用户自建的项用存储名 */
  const nameOf = (item: StyleItemView): string => displayBuiltinName(item.id, item.name, t)

  /** 保存 */
  const save = async (): Promise<void> => {
    if (!selected) return

    await window.preface.saveStyle({
      ...selected,
      text: draftText,
      samples: selected.kind === 'style' ? draftSamples : undefined
    })
    await reload(selected.id)
    // 通知主窗口刷新提示词
    window.dispatchEvent(new Event('preface:styles-changed'))
    onNotice({ kind: 'success', text: t('settings.prompts.saved', { name: nameOf(selected) }) })
  }

  /** 恢复默认 */
  const reset = async (): Promise<void> => {
    if (!selected) return
    await window.preface.resetStyle(selected.id)
    await reload(selected.id)
    window.dispatchEvent(new Event('preface:styles-changed'))
    onNotice({
      kind: 'success',
      text: t('settings.prompts.resetDone', { name: nameOf(selected) })
    })
  }

  /** 复制为新风格 */
  const duplicate = async (): Promise<void> => {
    if (!selected) return
    const id = `custom-${Date.now().toString(36)}`
    await window.preface.duplicateStyle(
      selected.id,
      id,
      newName.trim() || t('settings.prompts.copyName', { name: nameOf(selected) })
    )
    setDuplicateOpen(false)
    setNewName('')
    await reload(id)
    window.dispatchEvent(new Event('preface:styles-changed'))
    onNotice({ kind: 'success', text: t('settings.prompts.duplicated') })
  }

  /** 删除（只能删用户新建的） */
  const remove = async (): Promise<void> => {
    if (!selected) return
    const result = await window.preface.deleteStyle(selected.id)
    if (!result.ok) {
      onNotice({ kind: 'warning', text: t('settings.prompts.builtinNoDelete') })
      return
    }
    setSelectedId(null)
    await reload()
    window.dispatchEvent(new Event('preface:styles-changed'))
    onNotice({ kind: 'success', text: t('settings.prompts.deleted') })
  }

  /** 导出：生成 JSON 文件让用户保存 */
  const exportAll = async (): Promise<void> => {
    const json = await window.preface.exportStyles()
    // 用一个隐藏的下载链接把内容交给用户
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'preface-prompts.json'
    link.click()
    URL.revokeObjectURL(url)
    onNotice({ kind: 'success', text: t('settings.prompts.exported') })
  }

  /** 导入：选文件读内容 */
  const importFile = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return

      const json = await file.text()
      const result = await window.preface.importStyles(json)

      if (!result.ok) {
        onNotice({
          kind: 'warning',
          text: result.error
            ? t('settings.prompts.importFailedWith', { message: result.error })
            : t('settings.prompts.importFailed')
        })
        return
      }

      if (result.conflicts.length > 0) {
        // 有冲突：问用户覆盖还是另存
        setImportConflicts(result.items)
        setImportOpen(true)
        return
      }

      await window.preface.applyImport(result.items, true)
      await reload()
      window.dispatchEvent(new Event('preface:styles-changed'))
      onNotice({ kind: 'success', text: t('settings.prompts.imported') })
    }
    input.click()
  }

  /** 确认导入方式 */
  const confirmImport = async (overwrite: boolean): Promise<void> => {
    await window.preface.applyImport(importConflicts, overwrite)
    setImportOpen(false)
    setImportConflicts([])
    await reload()
    window.dispatchEvent(new Event('preface:styles-changed'))
    onNotice({
      kind: 'success',
      text: overwrite
        ? t('settings.prompts.importOverwritten')
        : t('settings.prompts.importSavedNew')
    })
  }

  /** 完整预览：按当前风格组装系统提示词 */
  const preview = useMemo(() => {
    if (!items) return { text: '', tokens: 0 }

    const styleId = useStore.getState().draft.styleId
    const text = buildSystemPrompt({
      styleId,
      maxQuestions: 3,
      overrides: toOverrides(items)
    })
    return { text, tokens: estimateTokens(text) }
  }, [items])

  /**
   * 试用：用当前编辑中（尚未保存）的提示词跑一次完整的优化。
   *
   * 不碰主窗口的草稿 —— 这里只发一次请求，把结果显示在设置页里。
   * 用的是 draftText，所以你改了还没保存也能先试试效果。
   */
  const tryRun = async (): Promise<void> => {
    if (!tryInput.trim() || !items) return

    setTryRunning(true)
    setTryOutput('')
    setTryUsage(null)

    try {
      // 用编辑中的内容组装提示词（把当前选中项替换成未保存的版本）
      const effectiveItems = items.map((i) =>
        i.id === selectedId ? { ...i, text: draftText, samples: draftSamples } : i
      )
      const overrides = toOverrides(effectiveItems)
      const styleId = useStore.getState().draft.styleId

      const systemPrompt = buildSystemPrompt({ styleId, maxQuestions: 3, overrides })
      const userMessage = buildOptimizeUserMessage({
        mode: 'auto',
        replyFormat: 'none',
        files: [],
        corpora: [],
        intentText: tryInput,
        maxQuestions: 3,
        corpusInfo: 'title'
      })

      let usageText: string | null = null

      const outcome = await run(
        'optimize',
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ],
        {
          sourceText: tryInput,
          trackStream: false,
          onDelta: (chunk) => setTryOutput((prev) => prev + chunk),
          onUsage: (usage) => {
            usageText = t('status.tokens', {
              count: formatTokenCount((usage.input ?? 0) + (usage.output ?? 0))
            })
          },
          onDone: (text) => {
            // 解析出行协议，只显示结果部分
            const parsed = parseReply(text)
            setTryOutput(parsed.result ?? text)
            setTryUsage(usageText)
          }
        }
      )

      if (outcome === null) {
        setTryOutput(t('settings.prompts.tryEmpty'))
      }
    } finally {
      setTryRunning(false)
    }
  }

  if (!items) return <Spinner label={t('settings.prompts.loading')} />

  const isLocked = selected?.id === LOCKED_BLOCK_ID
  const currentTokens = estimateTokens(draftText)
  // 翻译和优化表达不经过优化流程，试用区对它们会误导
  const tryUnavailable =
    selected?.id === 'translate' || selected?.id === 'expression'

  /** 左侧列表分组 */
  const groups: Array<{ title: string; filter: (i: StyleItemView) => boolean }> = [
    { title: t('settings.prompts.groupBlocks'), filter: (i) => i.kind === 'block' },
    { title: t('settings.prompts.groupTemplates'), filter: (i) => i.kind === 'template' },
    { title: t('settings.prompts.groupStyles'), filter: (i) => i.kind === 'style' },
    { title: t('settings.prompts.groupExtra'), filter: (i) => i.kind === 'extra' }
  ]

  return (
    <>
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          {groups.map((group) => {
            const groupItems = items.filter(group.filter)
            if (groupItems.length === 0) return null

            return (
              <div key={group.title}>
                <div className={styles.groupTitle}>{group.title}</div>
                {groupItems.map((item) => (
                  <div
                    key={item.id}
                    className={`${styles.item} ${item.id === selectedId ? styles.itemActive : ''}`}
                    onClick={() => select(item)}
                  >
                    <span>{nameOf(item)}</span>
                    {item.hasBuiltinUpdate && (
                      <span className={styles.editedMark}>{t('common.hasUpdate')}</span>
                    )}
                    {item.edited && !item.hasBuiltinUpdate && (
                      <span className={styles.editedMark}>{t('common.changed')}</span>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div className={styles.editor}>
          {selected ? (
            <>
              <div className={styles.editorTitle}>
                <span className={styles.title}>{nameOf(selected)}</span>
                {selected.id === LOCKED_BLOCK_ID && (
                  <Text size={200}>{t('settings.prompts.locked')}</Text>
                )}
              </div>

              {selected.id === 'translate' && (
                <MessageBar intent="info">
                  <MessageBarBody>{t('settings.language.hint')}</MessageBarBody>
                </MessageBar>
              )}

              {isLocked ? (
                <>
                  <MessageBar intent="info">
                    <MessageBarBody>{t('settings.prompts.lockedNotice')}</MessageBarBody>
                  </MessageBar>
                  <div className={styles.textareaBox}>
                    <div className={styles.readonly}>{draftText}</div>
                  </div>
                </>
              ) : (
                <>
                  {selected.hasBuiltinUpdate && (
                    <MessageBar intent="warning">
                      <MessageBarBody>{t('settings.prompts.updateNotice')}</MessageBarBody>
                      <Button
                        size="small"
                        onClick={() => void window.preface.resetStyle(selected.id).then(() => reload(selected.id))}
                      >
                        {t('settings.prompts.replaceNew')}
                      </Button>
                    </MessageBar>
                  )}

                  <div className={styles.textareaBox}>
                    <textarea
                      className={styles.textarea}
                      value={draftText}
                      onChange={(event) => setDraftText(event.target.value)}
                      spellCheck={false}
                    />
                  </div>

                  <div className={styles.tokenLine}>
                    {t('settings.prompts.tokenCount', {
                      count: formatNumber(currentTokens, language)
                    })}
                    {selected.kind === 'style' && ` ${t('settings.prompts.styleTokenHint')}`}
                  </div>

                  {/* 风格才有样本 */}
                  {selected.kind === 'style' && (
                    <Field
                      label={t('settings.prompts.samples')}
                      hint={t('settings.prompts.samplesHint')}
                    >
                      <div className={styles.samples}>
                        {draftSamples.map((sample, index) => (
                          <div key={index} className={styles.sampleRow}>
                            <textarea
                              className={styles.sampleInput}
                              value={sample}
                              onChange={(event) => {
                                const next = [...draftSamples]
                                next[index] = event.target.value
                                setDraftSamples(next)
                              }}
                              placeholder={t('settings.prompts.sampleN', { n: index + 1 })}
                              spellCheck={false}
                            />
                            <Button
                              appearance="subtle"
                              icon={<Delete20Regular />}
                              aria-label={t('settings.prompts.deleteSample')}
                              onClick={() =>
                                setDraftSamples(draftSamples.filter((_, i) => i !== index))
                              }
                            />
                          </div>
                        ))}

                        {draftSamples.length < 3 && (
                          <Button
                            icon={<Add20Regular />}
                            size="small"
                            onClick={() => setDraftSamples([...draftSamples, ''])}
                          >
                            {t('settings.prompts.addSample')}
                          </Button>
                        )}
                      </div>
                    </Field>
                  )}

                  {selected.id === 'my-style' && (
                    <div className={styles.tokenLine}>{t('settings.prompts.myStyleHint')}</div>
                  )}

                  <div className={styles.buttonRow}>
                    <Button
                      appearance="primary"
                      icon={<Save20Regular />}
                      disabled={!dirty}
                      onClick={() => void save()}
                    >
                      {t('common.save')}
                    </Button>

                    {selected.builtin && (
                      <Button
                        icon={<ArrowReset20Regular />}
                        onClick={() => void reset()}
                        disabled={!selected.edited && !selected.hasBuiltinUpdate}
                      >
                        {t('settings.prompts.resetDefault')}
                      </Button>
                    )}

                    {selected.kind === 'style' && (
                      <Button
                        icon={<Copy20Regular />}
                        onClick={() => {
                          setNewName(
                            t('settings.prompts.copyName', { name: nameOf(selected) })
                          )
                          setDuplicateOpen(true)
                        }}
                      >
                        {t('settings.prompts.duplicate')}
                      </Button>
                    )}

                    {!selected.builtin && (
                      <Button
                        icon={<Delete20Regular />}
                        onClick={() => void remove()}
                      >
                        {t('common.delete')}
                      </Button>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <Text>{t('settings.prompts.selectPrompt')}</Text>
          )}

          {/* 试用区：用当前编辑中的提示词跑一次，不影响主窗口草稿 */}
          {tryUnavailable ? (
            <MessageBar intent="info">
              <MessageBarBody>{t('settings.prompts.tryUnavailable')}</MessageBarBody>
            </MessageBar>
          ) : (
            <div className={styles.tryArea}>
              <Field label={t('settings.prompts.try')} hint={t('settings.prompts.tryHint')}>
                <Input
                  value={tryInput}
                  onChange={(_, d) => setTryInput(d.value)}
                  placeholder={t('settings.prompts.tryPlaceholder')}
                  disabled={tryRunning}
                />
              </Field>

              <div className={styles.buttonRow}>
                <Button
                  appearance="primary"
                  icon={<Play20Regular />}
                  disabled={tryRunning || !tryInput.trim()}
                  onClick={() => void tryRun()}
                >
                  {tryRunning ? t('settings.prompts.trying') : t('settings.prompts.tryButton')}
                </Button>
                {tryUsage && <span className={styles.tokenLine}>{tryUsage}</span>}
              </div>

              {tryOutput && <div className={styles.tryResult}>{tryOutput}</div>}
            </div>
          )}

          {/* 底部：预览与导入导出 */}
          <div className={styles.buttonRow}>
            <Button icon={<Eye20Regular />} onClick={() => setPreviewOpen(true)}>
              {t('settings.prompts.preview')}
            </Button>
            <Button onClick={() => void exportAll()}>{t('settings.prompts.export')}</Button>
            <Button onClick={importFile}>{t('settings.prompts.import')}</Button>
          </div>
        </div>
      </div>

      {/* 完整预览 */}
      <Dialog open={previewOpen} onOpenChange={(_, d) => !d.open && setPreviewOpen(false)}>
        <DialogSurface style={{ maxWidth: '760px', width: '90vw' }}>
          <DialogBody>
            <DialogTitle>{t('settings.prompts.previewTitle')}</DialogTitle>
            <DialogContent>
              <div className={styles.tokenLine} style={{ marginBottom: '8px' }}>
                {t('settings.prompts.previewTokens', {
                  count: formatNumber(preview.tokens, language)
                })}
                {preview.tokens > 1500 && (
                  <span className={styles.tokenWarn}>
                    {' · '}
                    {t('settings.prompts.previewLong')}
                  </span>
                )}
              </div>
              <div className={styles.preview}>{preview.text}</div>
            </DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => setPreviewOpen(false)}>
                {t('common.close')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 复制为新风格 */}
      <Dialog open={duplicateOpen} onOpenChange={(_, d) => !d.open && setDuplicateOpen(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('settings.prompts.copyTitle')}</DialogTitle>
            <DialogContent>
              <Field label={t('settings.prompts.copyNameLabel')}>
                <Input value={newName} onChange={(_, d) => setNewName(d.value)} />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDuplicateOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" onClick={() => void duplicate()}>
                {t('common.create')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 导入冲突 */}
      <Dialog open={importOpen} onOpenChange={(_, d) => !d.open && setImportOpen(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('settings.prompts.importTitle')}</DialogTitle>
            <DialogContent>
              {t('settings.prompts.importConflict', {
                count: formatNumber(importConflicts.length, language)
              })}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setImportOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void confirmImport(false)}>
                {t('settings.prompts.saveAsNew')}
              </Button>
              <Button appearance="primary" onClick={() => void confirmImport(true)}>
                {t('common.replace')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  )
}
