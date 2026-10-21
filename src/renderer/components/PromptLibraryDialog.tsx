import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
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
  Radio,
  RadioGroup,
  Spinner,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import {
  Add20Regular,
  ArrowEnter20Regular,
  Delete20Regular,
  Dismiss16Regular,
  Save20Regular,
  Sparkle16Regular
} from '@fluentui/react-icons'
import {
  type PromptLibraryItem,
  type PromptUsageMode
} from '../../shared/promptLibrary'
import { displayPromptTitle } from '../../shared/promptNames'
import { useTitle } from '../useTitle'
import { useT, useUiLanguage } from '../i18n'
import { formatNumber } from '../format'
import {
  beginTitleRequest,
  createTitleState,
  rebindTitleState,
  shouldApplyTitle,
  titleSourceAfterEdit,
  touchTitleState,
  type TitleRequestState
} from '../titleRequest'

/**
 * 「我的 Prompt 库」。
 *
 * 定位：长期保存的个人模板库，不是当前草稿的语料，也不是全局系统提示词配置。
 * 清空草稿、复制后换新草稿、历史过期都不删除这里的条目。
 *
 * 两个动作互不隐含：
 * - 「追加到原文」只是把正文加进原文；
 * - 「使用这个 Prompt」只是记下选择，不立刻发请求、也不改原文。
 */

const useStyles = makeStyles({
  surface: {
    width: 'min(920px, calc(100vw - 32px))',
    height: 'min(640px, calc(100dvh - 32px))',
    maxWidth: 'none',
    maxHeight: 'none'
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0
  },
  content: {
    display: 'flex',
    gap: '16px',
    flex: 1,
    minHeight: 0,
    paddingTop: '4px',
    '@media (max-width: 759px)': {
      flexDirection: 'column',
      gap: '8px',
      overflowY: 'auto'
    }
  },
  list: {
    width: '216px',
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    minHeight: 0,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingRight: '12px',
    '@media (max-width: 759px)': {
      width: '100%',
      maxHeight: '144px',
      borderRight: 'none',
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      paddingRight: 0,
      paddingBottom: '8px'
    },
    '@media (max-width: 759px) and (max-height: 600px)': {
      maxHeight: '112px'
    }
  },
  newButton: {
    flexShrink: 0,
    whiteSpace: 'nowrap'
  },
  listScroll: {
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    minHeight: 0,
    flex: 1
  },
  /*
   * 列表项沿用「设置 → 提示词与风格」的选中语言：
   * 中性底 + 左侧品牌色竖条，不用整圈描边或品牌色大底。
   */
  listItem: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '2px',
    flexShrink: 0,
    padding: '6px 10px',
    border: 'none',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: 'transparent',
    color: tokens.colorNeutralForeground1,
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground3Hover
    },
    '&:focus-visible': {
      outline: `2px solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '-2px'
    }
  },
  listItemActive: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: `inset 3px 0 0 0 ${tokens.colorBrandStroke1}`,
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground3
    }
  },
  listItemTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    width: '100%'
  },
  listItemMeta: {
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightRegular,
    color: tokens.colorNeutralForeground3
  },
  empty: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.6',
    padding: '8px 2px'
  },
  editor: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    minWidth: 0,
    minHeight: 0,
    '@media (max-width: 759px)': {
      flexShrink: 0
    }
  },
  titleRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    flexWrap: 'wrap'
  },
  titleInput: {
    flex: '1 1 220px',
    minWidth: 0
  },
  /** 正文的标签 + 编辑框，外层承接剩余高度 */
  field: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minHeight: 0,
    '@media (max-width: 759px)': {
      flex: 'none'
    }
  },
  fieldLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1
  },
  /** 正文区承接剩余高度；textarea 自己撑满这一层 */
  textareaBox: {
    flex: 1,
    minHeight: '200px',
    position: 'relative',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: 'hidden',
    '&:focus-within': {
      border: `1px solid ${tokens.colorStrokeFocus2}`
    },
    '@media (max-width: 759px)': {
      flex: 'none',
      height: '200px'
    },
    '@media (max-width: 759px) and (max-height: 600px)': {
      height: '144px'
    }
  },
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
    fontFamily: tokens.fontFamilyBase,
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.6'
  },
  /** 条目管理：删除、保存，与使用动作分开 */
  manageRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    flexWrap: 'wrap'
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  },
  error: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteRedForeground1
  },
  usageRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap'
  },
  usageLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  },
  /** 页脚：关闭在左，使用动作在右；窄窗口主按钮独占一行 */
  footer: {
    flexWrap: 'wrap',
    '@media (max-width: 759px)': {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr'
    }
  },
  footerClose: {
    '@media (max-width: 759px)': {
      justifySelf: 'start'
    }
  },
  footerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginLeft: 'auto',
    '@media (max-width: 759px)': {
      display: 'contents'
    }
  },
  footerButton: {
    whiteSpace: 'nowrap',
    '@media (max-width: 759px)': {
      width: '100%'
    }
  },
  footerPrimary: {
    whiteSpace: 'nowrap',
    '@media (max-width: 759px)': {
      gridColumn: '1 / -1',
      width: '100%'
    }
  }
})

interface Props {
  open: boolean
  onClose: () => void
  /** 把这条 Prompt 追加到原文末尾 */
  onAppend: (item: PromptLibraryItem) => void
  /** 设为优化时使用 */
  onUse: (item: PromptLibraryItem, mode: PromptUsageMode) => void
  /** 正在跑优化：可以看库，但不能追加/启动冲突操作 */
  busy: boolean
}

interface DraftState {
  id: string
  title: string
  content: string
  titleSource: 'user' | 'ai' | 'none'
  /** 是不是库里已有的条目 */
  existing: boolean
}

function blankDraft(): DraftState {
  return {
    id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    title: '',
    content: '',
    titleSource: 'none',
    existing: false
  }
}

function fromItem(item: PromptLibraryItem): DraftState {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    titleSource: item.titleSource,
    existing: true
  }
}

function isDirty(draft: DraftState, saved: PromptLibraryItem | undefined): boolean {
  if (!saved) return draft.title.trim() !== '' || draft.content.trim() !== ''
  return draft.title !== saved.title || draft.content !== saved.content
}

export function PromptLibraryDialog({ open, onClose, onAppend, onUse, busy }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const language = useUiLanguage()
  const [items, setItems] = useState<PromptLibraryItem[]>([])
  const [draft, setDraft] = useState<DraftState>(blankDraft)
  const [usageMode, setUsageMode] = useState<PromptUsageMode>('reference')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  /** 关闭时发现有未保存的修改，先确认 */
  const [pendingClose, setPendingClose] = useState<null | 'discard'>(null)
  /** 删除是不可逆的，先确认 */
  const [pendingDelete, setPendingDelete] = useState(false)
  const { generateForPrompt, generating, cancel } = useTitle()

  /** 标题生成的请求令牌：改标题/正文、切条目、关闭都会作废在途结果 */
  const titleStateRef = useRef<TitleRequestState>(createTitleState())

  const saved = items.find((i) => i.id === draft.id)
  const dirty = isDirty(draft, saved)

  /** 打开时重新读取库 */
  useEffect(() => {
    if (!open) return

    void (async () => {
      const result = await window.preface.listPrompts()
      if (!result.ok) {
        setLoadError(result.error)
        setItems([])
      } else {
        setLoadError(null)
        setItems(result.items)
      }
      setLoaded(true)
    })()

    // 重新打开：在途的标题请求作废
    const state = titleStateRef.current
    titleStateRef.current = rebindTitleState(state, state.editingKey)
    cancel()
    setSaveError(null)
    // cancel 是稳定引用
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /** 首次加载完成后，默认选中第一条（没有就新建） */
  useEffect(() => {
    if (!open || !loaded) return
    if (draft.existing || draft.content) return
    if (items.length > 0) {
      setDraft(fromItem(items[0]))
    }
    // 只在加载完成那一次执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded, items.length])

  /** 切到另一条 */
  const selectItem = useCallback(
    (item: PromptLibraryItem) => {
      setDraft(fromItem(item))
      setSaveError(null)
      const state = titleStateRef.current
      titleStateRef.current = rebindTitleState(state, item.id)
      cancel()
    },
    [cancel]
  )

  /** 新建一条（先不落盘） */
  const createNew = (): void => {
    setDraft(blankDraft())
    setSaveError(null)
    const state = titleStateRef.current
    titleStateRef.current = rebindTitleState(state, 'new')
    cancel()
  }

  const changeTitle = (value: string): void => {
    setDraft((prev) => ({
      ...prev,
      title: value,
      titleSource: titleSourceAfterEdit(value)
    }))
    titleStateRef.current = touchTitleState(titleStateRef.current)
    if (generating) cancel()
  }

  const changeContent = (value: string): void => {
    setDraft((prev) => ({ ...prev, content: value }))
    titleStateRef.current = touchTitleState(titleStateRef.current)
    if (generating) cancel()
  }

  /** AI 总结适用场景起标题 */
  const generateScenarioTitle = async (): Promise<void> => {
    const { state, token } = beginTitleRequest(titleStateRef.current)
    titleStateRef.current = state

    const result = await generateForPrompt(draft.content)
    if (!result) return
    if (!shouldApplyTitle(token, titleStateRef.current)) return

    setDraft((prev) => ({ ...prev, title: result, titleSource: 'ai' }))
  }

  /** 保存当前条目 */
  const save = async (): Promise<PromptLibraryItem | null> => {
    if (!draft.content.trim()) {
      setSaveError(t('promptLibrary.contentEmpty'))
      return null
    }

    setSaving(true)
    setSaveError(null)
    try {
      const result = await window.preface.savePrompt({
        id: draft.id,
        title: draft.title,
        content: draft.content,
        titleSource: draft.titleSource
      })
      if (!result.ok) {
        // 保存失败保留输入，不能假报成功
        setSaveError(result.error)
        return null
      }

      setItems(result.items)
      const updated = result.items.find((i) => i.id === draft.id)
      if (updated) {
        setDraft(fromItem(updated))
        return updated
      }
      return null
    } finally {
      setSaving(false)
    }
  }

  /** 删除当前条目（已确认） */
  const remove = async (): Promise<void> => {
    if (!draft.existing) {
      createNew()
      return
    }

    const result = await window.preface.deletePrompt(draft.id)
    if (!result.ok) {
      setSaveError(result.error)
      return
    }

    setItems(result.items)
    if (result.items.length > 0) {
      setDraft(fromItem(result.items[0]))
    } else {
      setDraft(blankDraft())
    }
    setSaveError(null)
    setPendingDelete(false)
  }

  /** 删除前先问一句 */
  const requestDelete = (): void => {
    if (!draft.existing) {
      createNew()
      return
    }
    setPendingDelete(true)
  }

  /** 需要先保存才能用的动作（追加、使用） */
  const ensureSaved = async (): Promise<PromptLibraryItem | null> => {
    if (saved && !dirty) return saved
    return save()
  }

  const handleAppend = async (): Promise<void> => {
    const item = await ensureSaved()
    if (!item) return
    // 追加是唯一会改原文的动作，关闭弹窗前先把在途标题请求作废
    const state = titleStateRef.current
    titleStateRef.current = rebindTitleState(state, state.editingKey)
    cancel()
    onAppend(item)
    onClose()
  }

  const handleUse = async (): Promise<void> => {
    const item = await ensureSaved()
    if (!item) return
    onUse(item, usageMode)
    onClose()
  }

  const requestClose = (): void => {
    if (dirty && draft.content.trim() !== '') {
      setPendingClose('discard')
      return
    }
    onClose()
  }

  const confirmClose = (): void => {
    setPendingClose(null)
    onClose()
  }

  const canEdit = !busy

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(_, data) => {
          if (!data.open) requestClose()
        }}
      >
        <DialogSurface className={styles.surface}>
          <DialogBody className={styles.body}>
            <DialogTitle>{t('promptLibrary.title')}</DialogTitle>
            <DialogContent className={styles.content}>
              <div className={styles.list}>
                <Button
                  className={styles.newButton}
                  appearance="secondary"
                  icon={<Add20Regular />}
                  onClick={createNew}
                >
                  {t('promptLibrary.new')}
                </Button>

                <div className={styles.listScroll}>
                  {loadError && <div className={styles.error}>{loadError}</div>}
                  {!loadError && items.length === 0 && (
                    <div className={styles.empty}>
                      {t('promptLibrary.emptyLine1')}
                      <br />
                      {t('promptLibrary.emptyLine2')}
                    </div>
                  )}
                  {items.map((item) => {
                    const title = displayPromptTitle(item.title, t)
                    const active = item.id === draft.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`${styles.listItem} ${
                          active ? styles.listItemActive : ''
                        }`}
                        aria-current={active ? 'true' : undefined}
                        title={title}
                        onClick={() => selectItem(item)}
                      >
                        <span className={styles.listItemTitle}>{title}</span>
                        <span className={styles.listItemMeta}>
                          {t('promptLibrary.charCount', {
                            count: formatNumber(Array.from(item.content).length, language)
                          })}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className={styles.editor}>
                <Field label={t('promptLibrary.titleLabel')}>
                  <div className={styles.titleRow}>
                    <Input
                      className={styles.titleInput}
                      value={draft.title}
                      onChange={(_, data) => changeTitle(data.value)}
                      placeholder={t('promptLibrary.titlePlaceholder')}
                    />
                    <Button
                      icon={generating ? <Spinner size="tiny" /> : <Sparkle16Regular />}
                      disabled={generating || !draft.content.trim() || !canEdit}
                      onClick={() => void generateScenarioTitle()}
                    >
                      {t('promptLibrary.generateTitle')}
                    </Button>
                    {generating && (
                      <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={cancel}>
                        {t('corpus.cancelGenerate')}
                      </Button>
                    )}
                  </div>
                </Field>

                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="prompt-content">
                    {t('promptLibrary.contentLabel')}
                  </label>
                  <div className={styles.textareaBox}>
                    <textarea
                      id="prompt-content"
                      className={styles.textarea}
                      value={draft.content}
                      onChange={(event) => changeContent(event.target.value)}
                      placeholder={t('promptLibrary.contentPlaceholder')}
                      spellCheck={false}
                    />
                  </div>
                </div>

                {saveError && <div className={styles.error}>{saveError}</div>}

                {/* 条目管理放在编辑区，和下方的使用动作分开 */}
                <div className={styles.manageRow}>
                  <Button
                    appearance="subtle"
                    icon={<Delete20Regular />}
                    onClick={requestDelete}
                    disabled={saving}
                  >
                    {t('common.delete')}
                  </Button>
                  <Button
                    icon={<Save20Regular />}
                    onClick={() => void save()}
                    disabled={saving || !draft.content.trim()}
                  >
                    {saving ? t('common.saving') : t('common.save')}
                  </Button>
                </div>

                <div className={styles.usageRow}>
                  <span className={styles.usageLabel} id="prompt-usage-label">
                    {t('promptLibrary.usage')}
                  </span>
                  <RadioGroup
                    layout="horizontal"
                    aria-labelledby="prompt-usage-label"
                    value={usageMode}
                    onChange={(_, data) => setUsageMode(data.value as PromptUsageMode)}
                  >
                    <Radio value="reference" label={t('prompt.mode.reference')} />
                    <Radio value="template" label={t('prompt.mode.template')} />
                  </RadioGroup>
                </div>
                <div className={styles.hint}>
                  {usageMode === 'reference'
                    ? t('promptLibrary.usageReferenceHint')
                    : t('promptLibrary.usageTemplateHint')}
                  {busy && ` ${t('promptLibrary.busyHint')}`}
                </div>
              </div>
            </DialogContent>

            <DialogActions className={styles.footer}>
              <Button
                className={styles.footerClose}
                appearance="secondary"
                onClick={requestClose}
              >
                {t('common.close')}
              </Button>
              <div className={styles.footerActions}>
                <Button
                  className={styles.footerButton}
                  icon={<ArrowEnter20Regular />}
                  onClick={() => void handleAppend()}
                  disabled={saving || !canEdit || !draft.content.trim()}
                >
                  {t('promptLibrary.append')}
                </Button>
                <Button
                  className={styles.footerPrimary}
                  appearance="primary"
                  onClick={() => void handleUse()}
                  disabled={saving || !draft.content.trim()}
                >
                  {t('promptLibrary.use')}
                </Button>
              </div>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 有未保存的修改，关闭前确认 */}
      <Dialog
        open={pendingClose !== null}
        onOpenChange={(_, data) => !data.open && setPendingClose(null)}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('dialog.unsaved.title')}</DialogTitle>
            <DialogContent>{t('dialog.unsaved.body')}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={confirmClose}>
                {t('dialog.unsaved.discard')}
              </Button>
              <Button
                appearance="primary"
                onClick={() => {
                  void (async () => {
                    const item = await save()
                    if (!item) return
                    setPendingClose(null)
                    onClose()
                  })()
                }}
              >
                {t('dialog.unsaved.saveClose')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* 删除不可逆，先确认 */}
      <Dialog open={pendingDelete} onOpenChange={(_, data) => !data.open && setPendingDelete(false)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t('promptLibrary.deleteTitle')}</DialogTitle>
            <DialogContent>
              {t('promptLibrary.deleteBody', {
                title: displayPromptTitle(draft.title, t)
              })}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setPendingDelete(false)}>
                {t('common.cancel')}
              </Button>
              <Button appearance="primary" onClick={() => void remove()}>
                {t('common.delete')}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  )
}
