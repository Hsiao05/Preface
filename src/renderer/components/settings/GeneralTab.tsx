import { useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Switch,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import {
  ArrowReset20Regular,
  ZoomIn20Regular,
  ZoomOut20Regular
} from '@fluentui/react-icons'
import type { Settings } from '../../../main/settings'
import { useT } from '../../i18n'
import { useStore } from '../../store'
import {
  TRANSLATION_LANGUAGES,
  sanitizeTranslationTarget,
  translationLanguageLabel
} from '../../../shared/translationLanguages'

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    paddingTop: '4px'
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400
  },
  hint: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.6'
  },
  row: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '8px'
  },
  zoomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  zoomValue: {
    minWidth: '52px',
    textAlign: 'center',
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase300
  },

  grow: {
    flex: 1
  }
})

interface Props {
  onNotice: (n: { text: string; kind: 'info' | 'warning' | 'success' } | null) => void
}

export function SettingsGeneral({ onNotice }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const uiLanguage = useStore((s) => s.uiLanguage)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shortcutInput, setShortcutInput] = useState('')
  const [customTarget, setCustomTarget] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [targetError, setTargetError] = useState(false)

  useEffect(() => {
    void (async () => {
      const s = await window.preface.getSettings()
      setSettings(s)
      setShortcutInput(await window.preface.shortcutLabel(s.shortcut))
      const isPreset = TRANSLATION_LANGUAGES.some((l) => l.id === s.translationTarget)
      setCustomTarget(!isPreset)
      setTargetInput(isPreset ? '' : s.translationTarget)
    })()
  }, [])

  const patch = async (changes: Partial<Settings>): Promise<void> => {
    const result = (await window.preface.setSettings(changes)) as {
      ok: boolean
      reason?: string
      settings: Settings
    }
    if (!result.ok) {
      onNotice({
        kind: 'warning',
        text: t('settings.general.shortcutTaken')
      })
      setSettings(result.settings)
      setShortcutInput(await window.preface.shortcutLabel(result.settings.shortcut))
      return
    }
    setSettings(result.settings)
    // 广播出去，让主窗口跟着变（Token 用量这类显示开关）
    window.dispatchEvent(new Event('preface:settings-changed'))
  }

  /** 保存自定义翻译语言 */
  const saveCustomTarget = (): void => {
    const cleaned = sanitizeTranslationTarget(targetInput)
    if (!targetInput.trim()) {
      setTargetError(true)
      return
    }
    setTargetError(false)
    setTargetInput(cleaned)
    void patch({ translationTarget: cleaned })
  }

  /**
   * 调整界面缩放。
   * 传 0 表示恢复默认（100%）。
   */
  const changeZoom = async (delta: number): Promise<void> => {
    if (!settings) return

    let next = delta === 0 ? 1 : settings.zoom + delta
    // 保留一位小数，避免 0.7000000001 这种浮点误差
    next = Math.round(next * 10) / 10
    next = Math.max(0.7, Math.min(1.5, next))

    // 先本地更新，界面立刻响应
    setSettings({ ...settings, zoom: next })
    await window.preface.setSettings({ zoom: next })
  }

  /** 切换主题：存设置，主窗口收到广播后跟着变 */
  const changeTheme = async (theme: 'system' | 'light' | 'dark'): Promise<void> => {
    // patch 里已经广播了 settings-changed，主窗口那次会一起读到 theme
    await patch({ theme })
  }

  if (!settings) return <div />

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>{t('settings.general.title')}</div>

      <Field label={t('settings.general.shortcut')} hint={t('settings.general.shortcutHint')}>
        <div className={styles.row}>
          <Input
            className={styles.grow}
            value={shortcutInput}
            readOnly
            onKeyDown={(event) => {
              event.preventDefault()
              const parts: string[] = []
              if (event.ctrlKey) parts.push('CommandOrControl')
              if (event.shiftKey) parts.push('Shift')
              if (event.altKey) parts.push('Alt')

              const key = event.key
              if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return

              let keyName = key
              if (key === ' ') keyName = 'Space'
              else if (key === 'Enter') keyName = 'Enter'
              else if (key.length === 1) keyName = key.toUpperCase()

              if (parts.length === 0) return
              parts.push(keyName)
              const accelerator = parts.join('+')

              void window.preface.shortcutLabel(accelerator).then(setShortcutInput)
              void patch({ shortcut: accelerator })
            }}
          />
        </div>
      </Field>

      <Switch
        label={t('settings.general.autoLaunch')}
        checked={settings.autoLaunch}
        onChange={(_, d) => void patch({ autoLaunch: d.checked })}
      />

      <Switch
        label={t('settings.general.alwaysOnTop')}
        checked={settings.alwaysOnTop}
        onChange={(_, d) => void patch({ alwaysOnTop: d.checked })}
      />

      <Field
        label={t('settings.general.zoom')}
        hint={t('settings.general.zoomHint')}
      >
        <div className={styles.zoomRow}>
          <Button
            icon={<ZoomOut20Regular />}
            disabled={settings.zoom <= 0.7}
            onClick={() => void changeZoom(-0.1)}
            aria-label={t('settings.general.zoomOut')}
          />
          <span className={styles.zoomValue}>{Math.round(settings.zoom * 100)}%</span>
          <Button
            icon={<ZoomIn20Regular />}
            disabled={settings.zoom >= 1.5}
            onClick={() => void changeZoom(0.1)}
            aria-label={t('settings.general.zoomIn')}
          />
          <Button
            icon={<ArrowReset20Regular />}
            disabled={settings.zoom === 1}
            onClick={() => void changeZoom(0)}
          >
            {t('settings.general.resetDefault')}
          </Button>
        </div>
      </Field>

      <Field label={t('settings.general.theme')}>
        <Dropdown
          selectedOptions={[settings.theme]}
          value={
            settings.theme === 'system'
              ? t('settings.general.themeSystem')
              : settings.theme === 'light'
                ? t('settings.general.themeLight')
                : t('settings.general.themeDark')
          }
          onOptionSelect={(_, d) =>
            void changeTheme(d.optionValue as 'system' | 'light' | 'dark')
          }
        >
          <Option value="system">{t('settings.general.themeSystem')}</Option>
          <Option value="light">{t('settings.general.themeLight')}</Option>
          <Option value="dark">{t('settings.general.themeDark')}</Option>
        </Dropdown>
      </Field>

      <div className={styles.sectionTitle}>{t('settings.general.language')}</div>

      <Field label={t('settings.general.uiLanguage')}>
        <Dropdown
          selectedOptions={[settings.uiLanguage]}
          value={settings.uiLanguage === 'en' ? t('language.en') : t('language.zh')}
          onOptionSelect={(_, d) =>
            void patch({ uiLanguage: d.optionValue as 'zh' | 'en' })
          }
        >
          <Option value="zh">{t('language.zh')}</Option>
          <Option value="en">{t('language.en')}</Option>
        </Dropdown>
      </Field>

      <Field
        label={t('settings.general.translationTarget')}
        hint={t('settings.general.translationHint')}
        validationMessage={
          targetError ? t('settings.general.translationEmpty') : undefined
        }
        validationState={targetError ? 'error' : 'none'}
      >
        <div className={styles.section}>
          <Dropdown
            selectedOptions={[
              customTarget ? '__custom' : settings.translationTarget
            ]}
            value={
              customTarget
                ? t('settings.general.translationCustom')
                : translationLanguageLabel(settings.translationTarget, uiLanguage)
            }
            onOptionSelect={(_, d) => {
              const value = d.optionValue
              if (!value) return
              if (value === '__custom') {
                setCustomTarget(true)
                setTargetError(false)
                return
              }
              setCustomTarget(false)
              setTargetError(false)
              void patch({ translationTarget: value })
            }}
          >
            {TRANSLATION_LANGUAGES.map((language) => (
              <Option key={language.id} value={language.id}>
                {translationLanguageLabel(language.id, uiLanguage)}
              </Option>
            ))}
            <Option value="__custom">{t('settings.general.translationCustom')}</Option>
          </Dropdown>

          {customTarget && (
            <Input
              value={targetInput}
              placeholder={t('settings.general.translationPlaceholder')}
              onChange={(_, d) => {
                setTargetInput(d.value)
                setTargetError(false)
              }}
              onBlur={saveCustomTarget}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveCustomTarget()
              }}
            />
          )}
        </div>
      </Field>

      <div className={styles.sectionTitle}>{t('settings.general.defaults')}</div>

      <Field
        label={t('settings.general.maxQuestions')}
        hint={t('settings.general.maxQuestionsHint')}
      >
        <Input
          type="number"
          value={String(settings.maxQuestions)}
          onChange={(_, d) => {
            const n = Math.max(0, Math.min(5, Number(d.value) || 0))
            void patch({ maxQuestions: n })
          }}
        />
      </Field>

      <Switch
        label={t('settings.general.tidyStyleSamples')}
        checked={settings.tidyUseStyleSamples}
        onChange={(_, d) => void patch({ tidyUseStyleSamples: d.checked })}
      />

      <Switch
        label={t('settings.general.showTokenUsage')}
        checked={settings.showTokenUsage}
        onChange={(_, d) => void patch({ showTokenUsage: d.checked })}
      />

      <div className={styles.sectionTitle}>{t('settings.general.advanced')}</div>

      <Field hint={t('settings.general.debugLogHint')}>
        <Switch
          label={t('settings.general.debugLog')}
          checked={settings.debugLog}
          onChange={(_, d) => void patch({ debugLog: d.checked })}
        />
      </Field>

      <div className={styles.hint}>
        {t('settings.general.logLocation')}
        <br />
        <code>{settings ? '' : ''}</code>
        <LogPath />
      </div>
    </div>
  )
}

function LogPath(): JSX.Element {
  const [path, setPath] = useState('')
  useEffect(() => {
    void window.preface.getLogPath().then(setPath)
  }, [])
  return <code style={{ wordBreak: 'break-all' }}>{path}</code>
}
