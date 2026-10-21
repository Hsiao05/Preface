import { useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dropdown,
  Option,
  makeStyles,
  tokens,
  Tooltip
} from '@fluentui/react-components'
import { Add20Regular, TextAdd20Regular, Settings20Regular } from '@fluentui/react-icons'
import { useStore } from '../store'
import { useT } from '../i18n'
import { translate } from '../../shared/i18n'
import { displayBuiltinName } from '../../shared/promptNames'
import { CorpusDialog } from './CorpusDialog'
import { addCorpusToDraft } from '../corpusActions'
import type { ProfilesView, StyleItemView } from '../../preload/index'
import type { Target, TitleSource } from '../../shared/types'

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    // 窗口窄时整组换行，而不是把按钮压到文字折行
    flexWrap: 'wrap'
  },
  spacer: {
    flex: 1,
    minWidth: 0
  },
  /**
   * 左上角两个按钮。
   *
   * 【必须不换行】窗口偏窄时 flex 会把按钮压扁，Fluent 的按钮文字
   * 就折成两行（「上传文件」变成「上传 / 文件」），顶栏高度跟着变。
   * 让按钮保持自己的宽度，宁可挤 spacer。
   */
  actionButton: {
    whiteSpace: 'nowrap',
    flexShrink: 0
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    whiteSpace: 'nowrap'
  },
  label: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  },
  dropdown: {
    minWidth: '104px'
  },
  modelDropdown: {
    minWidth: '128px',
    maxWidth: '180px'
  },
  noModel: {
    color: tokens.colorPaletteRedForeground1
  }
})

interface TopBarProps {
  onOpenSettings: () => void
}

export function TopBar({ onOpenSettings }: TopBarProps): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const uiLanguage = useStore((s) => s.uiLanguage)
  const { draft, styleId, setStyleId, setTarget } = useStore()
  const [corpusOpen, setCorpusOpen] = useState(false)
  // 正在编辑的语料。为 null 表示新建。
  const [editingCorpus, setEditingCorpus] = useState<{
    id: string
    title: string
    titleSource: TitleSource
    content: string
  } | null>(null)
  const [profiles, setProfiles] = useState<ProfilesView | null>(null)
  const [styleItems, setStyleItems] = useState<StyleItemView[]>([])

  // 读取模型配置列表，用于顶栏的切换下拉框
  useEffect(() => {
    const load = (): void => {
      void window.preface.listProfiles().then(setProfiles)
    }
    load()
    // 设置窗口保存后要能刷新到这里
    window.addEventListener('preface:profiles-changed', load)
    return () => window.removeEventListener('preface:profiles-changed', load)
  }, [])

  // 读取风格列表。设置页改了风格之后要刷新。
  useEffect(() => {
    const load = (): void => {
      void window.preface.listStyles().then((data) => {
        setStyleItems(data.items.filter((i) => i.kind === 'style'))
      })
    }
    load()
    window.addEventListener('preface:styles-changed', load)
    return () => window.removeEventListener('preface:styles-changed', load)
  }, [])

  const currentProfile = profiles?.profiles.find((p) => p.id === profiles.currentId) ?? null
  const currentStyle = styleItems.find((s) => s.id === styleId)
  const currentStyleName = currentStyle
    ? displayBuiltinName(currentStyle.id, currentStyle.name, t)
    : displayBuiltinName(styleId, styleId, t)

  /** 切换当前使用的模型配置 */
  const switchProfile = async (id: string): Promise<void> => {
    const next = await window.preface.setCurrentProfile(id)
    setProfiles(next)
    const picked = next.profiles.find((p) => p.id === id)
    useStore.getState().setNotice({
      kind: 'success',
      text: picked
        ? t('topBar.switchedTo', { name: picked.name })
        : t('topBar.switchedModel')
    })
  }

  /** 打开文件选择框 */
  const handlePickFiles = async (): Promise<void> => {
    const paths = await window.preface.pickFiles()
    if (paths.length === 0) return
    await addPathsToDraft(paths)
  }

  /** 确认粘贴语料。titleSource 由对话框跟踪：手填 user、AI 回填 ai、空标题 none。 */
  const handleCorpusConfirm = (
    title: string,
    content: string,
    titleSource: TitleSource,
    editingId?: string
  ): void => {
    const state = useStore.getState()

    // 编辑已有语料
    if (editingId) {
      state.updateCorpus(editingId, {
        title,
        titleSource,
        content,
        chars: content.length
      })
      setEditingCorpus(null)
      state.setNotice({
        kind: 'success',
        text: t('topBar.corpusUpdated', {
          id: editingId,
          count: content.length.toLocaleString(uiLanguage === 'en' ? 'en-US' : 'zh-CN')
        })
      })
      return
    }

    // 新建：编号优先复用"既没被占用、也没被引用"的
    const corpus = addCorpusToDraft(title, content, titleSource)
    state.setNotice({
      kind: 'success',
      text: t('topBar.corpusAdded', {
        id: corpus.id,
        count: content.length.toLocaleString(uiLanguage === 'en' ? 'en-US' : 'zh-CN')
      })
    })
  }

  /** 打开"粘贴语料"（新建） */
  const openNewCorpus = (): void => {
    setEditingCorpus(null)
    setCorpusOpen(true)
  }

  /** 点击语料标签：打开编辑窗口 */
  useEffect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ id: string }>).detail
      const state = useStore.getState()
      const corpus = state.draft.corpora.find((c) => c.id === detail.id)
      if (!corpus) return

      setEditingCorpus({
        id: corpus.id,
        title: corpus.title,
        titleSource: corpus.titleSource,
        content: corpus.content
      })
      setCorpusOpen(true)
    }

    window.addEventListener('preface:edit-corpus', handler)
    return () => window.removeEventListener('preface:edit-corpus', handler)
  }, [])

  return (
    <>
      <div className={styles.bar}>
        <Button
          className={styles.actionButton}
          appearance="subtle"
          icon={<Add20Regular />}
          onClick={() => void handlePickFiles()}
        >
          {t('topBar.addFiles')}
        </Button>
        <Button
          className={styles.actionButton}
          appearance="subtle"
          icon={<TextAdd20Regular />}
          onClick={openNewCorpus}
        >
          {t('topBar.pasteCorpus')}
        </Button>

        <div className={styles.spacer} />

        {/* 模型切换：配了多套时直接在这里换 */}
        <div className={styles.field}>
          <span className={styles.label}>{t('topBar.model')}</span>
          <Dropdown
            className={styles.modelDropdown}
            size="small"
            value={
              currentProfile
                ? currentProfile.name
                : profiles && profiles.profiles.length === 0
                  ? t('topBar.notConfigured')
                  : t('topBar.loading')
            }
            selectedOptions={profiles?.currentId ? [profiles.currentId] : []}
            onOptionSelect={(_, data) => {
              if (data.optionValue) void switchProfile(data.optionValue)
            }}
          >
            {(profiles?.profiles ?? []).map((p) => (
              <Option key={p.id} value={p.id} text={p.name}>
                {p.name}
                {p.model ? ` (${p.model})` : ''}
              </Option>
            ))}
            {(profiles?.profiles ?? []).length === 0 && (
              <Option value="__none" disabled>
                {t('topBar.noModels')}
              </Option>
            )}
          </Dropdown>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>{t('topBar.style')}</span>
          <Dropdown
            className={styles.dropdown}
            size="small"
            value={currentStyleName}
            selectedOptions={[styleId]}
            onOptionSelect={(_, data) => setStyleId(data.optionValue as string)}
          >
            {styleItems.map((style) => {
              // "我的风格"没有样本时不可选
              const myStyleBlocked =
                style.id === 'my-style' && (!style.samples || style.samples.length === 0)
              const name = displayBuiltinName(style.id, style.name, t)

              return (
                <Option
                  key={style.id}
                  value={style.id}
                  disabled={myStyleBlocked}
                  text={myStyleBlocked ? t('topBar.addSamplesFirst') : name}
                >
                  {myStyleBlocked ? t('topBar.myStyleNeedsSamples') : name}
                </Option>
              )
            })}
            {styleItems.length === 0 && (
              <Option value="clear-direct">
                {displayBuiltinName('clear-direct', 'clear-direct', t)}
              </Option>
            )}
          </Dropdown>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>{t('topBar.target')}</span>
          <Dropdown
            className={styles.dropdown}
            size="small"
            selectedOptions={[draft.target]}
            value={draft.target === 'local' ? t('topBar.localAgent') : t('topBar.web')}
            onOptionSelect={(_, data) => setTarget(data.optionValue as Target)}
          >
            <Option value="local">{t('topBar.localAgent')}</Option>
            <Option value="web">{t('topBar.web')}</Option>
          </Dropdown>
        </div>

        <Tooltip content={t('topBar.settings')} relationship="label">
          <Button
            appearance="subtle"
            icon={<Settings20Regular />}
            onClick={onOpenSettings}
            aria-label={t('topBar.settings')}
          />
        </Tooltip>
      </div>

      {/* Prompt 库的入口在底栏，这里只负责语料编辑 */}
      <CorpusDialog
        open={corpusOpen}
        onClose={() => {
          setCorpusOpen(false)
          setEditingCorpus(null)
        }}
        onConfirm={handleCorpusConfirm}
        editing={editingCorpus}
      />
    </>
  )
}

/** 把路径加入草稿。选择框和拖入共用这段逻辑。 */
export async function addPathsToDraft(paths: string[]): Promise<void> {
  const state = useStore.getState()
  const { added, nextNo, skipped } = await window.preface.addFiles(
    paths,
    state.draft.files,
    state.draft.intentText,
    state.draft.nextFileNo
  )

  if (added.length > 0) {
    state.addFiles(added, nextNo)
  }

  if (skipped.length > 0 && added.length === 0) {
    state.setNotice({
      kind: 'warning',
      text: translate(state.uiLanguage, 'topBar.filesAlreadyAdded')
    })
  } else if (skipped.length > 0) {
    state.setNotice({
      kind: 'info',
      text: translate(state.uiLanguage, 'topBar.filesAddedSkipped', {
        added: added.length,
        skipped: skipped.length
      })
    })
  }
}
