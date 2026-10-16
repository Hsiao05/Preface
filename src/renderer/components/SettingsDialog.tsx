import { useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Option,
  Spinner,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import {
  Add20Regular,
  Delete20Regular,
  Dismiss16Regular,
  Dismiss20Regular,
  Key20Regular
} from '@fluentui/react-icons'
import { SettingsGeneral } from './settings/GeneralTab'
import { SettingsAbout } from './settings/AboutTab'
import { HistoryPanel } from './settings/HistoryPanel'
import { PromptsTab } from './settings/PromptsTab'
import { SpeechTab } from './settings/SpeechTab'
import type { ProfileView, ProfilesView } from '../../preload/index'

const useStyles = makeStyles({
  surface: {
    maxWidth: '820px',
    width: '92vw',
    height: '78vh'
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: 0,
    height: '100%'
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  notice: {
    marginTop: '4px'
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    paddingRight: '4px'
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-end'
  },
  grow: {
    flex: 1
  },
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  profileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    cursor: 'pointer'
  },
  profileItemActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2
  },
  profileName: {
    flex: 1,
    fontWeight: tokens.fontWeightSemibold
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.6'
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingTop: '4px'
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400
  },
  buttonRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  models: {
    maxHeight: '160px',
    overflowY: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: '6px'
  },
  modelItem: {
    padding: '4px 8px',
    cursor: 'pointer',
    borderRadius: '4px',
    fontSize: tokens.fontSizeBase200,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground3Hover }
  }
})

interface Props {
  open: boolean
  onClose: () => void
}

/** 设置窗口里的提示条。测试连接、保存等结果都显示在这里，不跑到主窗口去。 */
interface SettingsNotice {
  text: string
  kind: 'info' | 'warning' | 'success'
}

export function SettingsDialog({ open, onClose }: Props): JSX.Element {
  const styles = useStyles()
  const [tab, setTab] = useState<
    'general' | 'model' | 'speech' | 'prompts' | 'history' | 'about'
  >('general')
  const [notice, setNotice] = useState<SettingsNotice | null>(null)

  // 关掉窗口时清掉提示，下次打开是干净的
  useEffect(() => {
    if (!open) setNotice(null)
  }, [open])

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onClose()}>
      <DialogSurface className={styles.surface}>
        <DialogBody className={styles.body}>
          <div className={styles.titleRow}>
            <DialogTitle>设置</DialogTitle>
            <Button
              appearance="subtle"
              icon={<Dismiss20Regular />}
              aria-label="关闭设置"
              onClick={onClose}
            />
          </div>

          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as typeof tab)}>
            <Tab value="general">通用</Tab>
            <Tab value="model">模型</Tab>
            <Tab value="speech">语音</Tab>
            <Tab value="prompts">提示词与风格</Tab>
            <Tab value="history">找回之前的内容</Tab>
            <Tab value="about">关于</Tab>
          </TabList>

          {notice && (
            <MessageBar
              className={styles.notice}
              intent={
                notice.kind === 'warning'
                  ? 'warning'
                  : notice.kind === 'success'
                    ? 'success'
                    : 'info'
              }
            >
              <MessageBarBody>{notice.text}</MessageBarBody>
              <MessageBarActions
                containerAction={
                  <Button
                    appearance="transparent"
                    icon={<Dismiss16Regular />}
                    aria-label="关闭提示"
                    onClick={() => setNotice(null)}
                  />
                }
              />
            </MessageBar>
          )}

          <DialogContent className={styles.content}>
            {tab === 'general' && <SettingsGeneral onNotice={setNotice} />}
            {tab === 'model' && <ModelTab onNotice={setNotice} />}
            {tab === 'speech' && <SpeechTab onNotice={setNotice} />}
            {tab === 'prompts' && <PromptsTab onNotice={setNotice} />}
            {tab === 'history' && <HistoryPanel onNotice={setNotice} />}
            {tab === 'about' && <SettingsAbout />}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}

/** 模型配置页 */
function ModelTab({
  onNotice
}: {
  onNotice: (n: { text: string; kind: 'info' | 'warning' | 'success' } | null) => void
}): JSX.Element {
  const styles = useStyles()
  const [data, setData] = useState<ProfilesView | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProfileView | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [models, setModels] = useState<Array<{ id: string; displayName?: string }>>([])
  const [busy, setBusy] = useState<'models' | 'test' | null>(null)
  const [manualModel, setManualModel] = useState(false)

  /** 通知主窗口刷新顶栏的模型下拉框 */
  const notifyProfilesChanged = (): void => {
    window.dispatchEvent(new Event('preface:profiles-changed'))
  }

  const reload = async (keepId?: string): Promise<void> => {
    const view = await window.preface.listProfiles()
    setData(view)
    notifyProfilesChanged()
    const id = keepId ?? selectedId ?? view.currentId ?? view.profiles[0]?.id ?? null
    setSelectedId(id)
    const profile = view.profiles.find((p) => p.id === id)
    setDraft(profile ? { ...profile } : null)
    setApiKeyInput('')
  }

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectProfile = (id: string): void => {
    setSelectedId(id)
    const profile = data?.profiles.find((p) => p.id === id)
    setDraft(profile ? { ...profile } : null)
    setApiKeyInput('')
    setModels([])
    setManualModel(false)
  }

  const addProfile = async (): Promise<void> => {
    const id = `p_${Date.now()}`
    const newProfile = {
      id,
      name: '新配置',
      format: 'openai' as const,
      baseUrl: '',
      model: '',
      temperature: 0.3,
      maxTokens: 4096,
      timeoutMs: 120000,
      privacyNoticeShown: false
    }
    await window.preface.saveProfile(newProfile)
    await reload(id)
  }

  const deleteProfile = async (): Promise<void> => {
    if (!draft) return
    await window.preface.deleteProfile(draft.id)
    setSelectedId(null)
    await reload()
  }

  const save = async (): Promise<void> => {
    if (!draft) return

    // 保存前先存 Key（如果填了）
    if (apiKeyInput.trim()) {
      const ok = await window.preface.setApiKey(draft.id, apiKeyInput.trim())
      if (!ok) {
        onNotice({ kind: 'warning', text: 'API Key 保存失败，系统可能不支持加密存储。' })
        return
      }
      setApiKeyInput('')
    }

    await window.preface.saveProfile({
      id: draft.id,
      name: draft.name,
      format: draft.format,
      baseUrl: draft.baseUrl,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      timeoutMs: draft.timeoutMs,
      privacyNoticeShown: draft.privacyNoticeShown
    })
    await window.preface.setCurrentProfile(draft.id)
    await reload(draft.id)
    notifyProfilesChanged()
    onNotice({ kind: 'success', text: `已保存「${draft.name}」，并设为当前使用的配置。` })
  }

  const fetchModels = async (): Promise<void> => {
    if (!draft) return
    setBusy('models')
    setModels([])
    setManualModel(false)

    // 先把当前填的内容存下来，否则主进程读到的是旧配置
    if (apiKeyInput.trim()) {
      await window.preface.setApiKey(draft.id, apiKeyInput.trim())
      setApiKeyInput('')
    }
    await window.preface.saveProfile({
      id: draft.id,
      name: draft.name,
      format: draft.format,
      baseUrl: draft.baseUrl,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      timeoutMs: draft.timeoutMs,
      privacyNoticeShown: draft.privacyNoticeShown
    })

    const result = await window.preface.listModels(draft.id)
    setBusy(null)

    if (result.ok) {
      setModels(result.models)
      if (result.models.length === 0) {
        setManualModel(true)
        onNotice({ kind: 'warning', text: '该服务没有返回任何模型，请手动输入模型名。' })
      }
    } else {
      setManualModel(true)
      onNotice({
        kind: 'warning',
        text: `${result.error.message}。该服务可能未提供模型列表，请手动输入模型名。`
      })
    }
  }

  const test = async (): Promise<void> => {
    if (!draft) return
    setBusy('test')

    if (apiKeyInput.trim()) {
      await window.preface.setApiKey(draft.id, apiKeyInput.trim())
      setApiKeyInput('')
    }
    await window.preface.saveProfile({
      id: draft.id,
      name: draft.name,
      format: draft.format,
      baseUrl: draft.baseUrl,
      model: draft.model,
      temperature: draft.temperature,
      maxTokens: draft.maxTokens,
      timeoutMs: draft.timeoutMs,
      privacyNoticeShown: draft.privacyNoticeShown
    })

    const result = await window.preface.testConnection(draft.id)
    setBusy(null)

    if (result.ok) {
      const extra = result.sawReasoning
        ? '（这个模型带推理过程，每次调用会更慢也更费 Token，建议换成非推理模型）'
        : ''
      onNotice({ kind: 'success', text: `连接成功，耗时 ${result.elapsedMs} 毫秒。${extra}` })
    } else {
      onNotice({
        kind: 'warning',
        text: `${result.error.message}${result.error.suggestion ? ' ' + result.error.suggestion : ''}`
      })
    }
  }

  if (!data) return <Spinner label="正在读取配置" />

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>模型配置</div>
      <div className={styles.hint}>
        可以保存多套配置，选一套作为当前使用的配置。API Key 会加密保存在本机，不会出现在界面里。
      </div>

      <div className={styles.profileList}>
        {data.profiles.map((p) => (
          <div
            key={p.id}
            className={`${styles.profileItem} ${p.id === selectedId ? styles.profileItemActive : ''}`}
            onClick={() => selectProfile(p.id)}
          >
            <span className={styles.profileName}>{p.name}</span>
            {p.id === data.currentId && <Text size={200}>当前使用</Text>}
            {p.hasKey && <Key20Regular />}
          </div>
        ))}
      </div>

      <Button icon={<Add20Regular />} onClick={() => void addProfile()}>
        添加配置
      </Button>

      {draft && (
        <div className={styles.section}>
          <Field label="名称">
            <Input
              value={draft.name}
              onChange={(_, d) => setDraft({ ...draft, name: d.value })}
              placeholder="例如：DeepSeek、Claude、本地模型"
            />
          </Field>

          <Field label="接口格式">
            <Dropdown
              value={draft.format === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容'}
              selectedOptions={[draft.format]}
              onOptionSelect={(_, d) =>
                setDraft({ ...draft, format: d.optionValue as 'openai' | 'anthropic' })
              }
            >
              <Option value="openai">OpenAI 兼容</Option>
              <Option value="anthropic">Anthropic 兼容</Option>
            </Dropdown>
          </Field>

          <Field label="Base URL">
            <Input
              value={draft.baseUrl}
              onChange={(_, d) => setDraft({ ...draft, baseUrl: d.value })}
              placeholder={
                draft.format === 'openai' ? 'https://api.deepseek.com' : 'https://api.anthropic.com'
              }
            />
          </Field>

          <Field
            label="API Key"
            hint={
              draft.hasKey
                ? '已设置。要换一个，就在下面填新的。'
                : '还没有设置。填入后会加密保存。'
            }
          >
            <Input
              type="password"
              value={apiKeyInput}
              onChange={(_, d) => setApiKeyInput(d.value)}
              placeholder={draft.hasKey ? '已设置（留空则不改）' : '粘贴你的 API Key'}
            />
          </Field>

          <Field label="模型">
            <div className={styles.row}>
              <Input
                className={styles.grow}
                value={draft.model}
                onChange={(_, d) => setDraft({ ...draft, model: d.value })}
                placeholder="例如：deepseek-chat"
              />
            </div>
          </Field>

          <div className={styles.hint}>
            推荐使用非推理（非思考）模型。提示词优化不需要长时间推理，推理模型会额外消耗大量看不见的
            Token，速度也更慢。
            <br />
            如果你用的是 DeepSeek，模型名建议填 <code>deepseek-chat</code>；
            <code>deepseek-reasoner</code> 是推理模型，容易把输出预算用在思考上，导致看不到正文。
          </div>

          <div className={styles.buttonRow}>
            <Button onClick={() => void fetchModels()} disabled={busy !== null}>
              {busy === 'models' ? <Spinner size="tiny" /> : null} 获取模型列表
            </Button>
            <Button onClick={() => void test()} disabled={busy !== null}>
              {busy === 'test' ? <Spinner size="tiny" /> : null} 测试连接
            </Button>
          </div>

          {models.length > 0 && (
            <div className={styles.models}>
              {models.map((m) => (
                <div
                  key={m.id}
                  className={styles.modelItem}
                  onClick={() => setDraft({ ...draft, model: m.id })}
                >
                  {m.id}
                  {m.displayName ? `（${m.displayName}）` : ''}
                </div>
              ))}
            </div>
          )}

          {manualModel && (
            <div className={styles.hint}>该服务未提供模型列表，请在上面的「模型」框里手动输入模型名。</div>
          )}

          <div className={styles.row}>
            <Field label="温度" className={styles.grow}>
              <Input
                type="number"
                value={String(draft.temperature)}
                onChange={(_, d) => setDraft({ ...draft, temperature: Number(d.value) || 0 })}
              />
            </Field>
            <Field label="最大输出长度" className={styles.grow}>
              <Input
                type="number"
                value={String(draft.maxTokens)}
                onChange={(_, d) => setDraft({ ...draft, maxTokens: Number(d.value) || 4096 })}
              />
            </Field>
            <Field label="超时（秒）" className={styles.grow}>
              <Input
                type="number"
                value={String(Math.round(draft.timeoutMs / 1000))}
                onChange={(_, d) =>
                  setDraft({ ...draft, timeoutMs: (Number(d.value) || 120) * 1000 })
                }
              />
            </Field>
          </div>

          <div className={styles.buttonRow}>
            <Button appearance="primary" onClick={() => void save()}>
              保存
            </Button>
            <Button
              icon={<Delete20Regular />}
              appearance="secondary"
              onClick={() => void deleteProfile()}
            >
              删除这套配置
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

