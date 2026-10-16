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

/** 主题取值的显示文字 */
const THEME_LABELS: Record<'system' | 'light' | 'dark', string> = {
  system: '跟随设备',
  light: '浅色',
  dark: '深色'
}

export function SettingsGeneral({ onNotice }: Props): JSX.Element {
  const styles = useStyles()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [shortcutInput, setShortcutInput] = useState('')

  useEffect(() => {
    void (async () => {
      const s = await window.preface.getSettings()
      setSettings(s)
      setShortcutInput(await window.preface.shortcutLabel(s.shortcut))
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
        text: '这个快捷键已经被其他程序占用了，请换一个。'
      })
      setSettings(result.settings)
      setShortcutInput(await window.preface.shortcutLabel(result.settings.shortcut))
      return
    }
    setSettings(result.settings)
    // 广播出去，让主窗口跟着变（Token 用量这类显示开关）
    window.dispatchEvent(new Event('preface:settings-changed'))
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
      <div className={styles.sectionTitle}>通用</div>

      <Field label="全局快捷键" hint="在输入框里按下想要的组合键，会自动填入。">
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
        label="开机自启"
        checked={settings.autoLaunch}
        onChange={(_, d) => void patch({ autoLaunch: d.checked })}
      />

      <Switch
        label="窗口置顶"
        checked={settings.alwaysOnTop}
        onChange={(_, d) => void patch({ alwaysOnTop: d.checked })}
      />

      <Field
        label="界面缩放"
        hint="整体放大或缩小界面。和浏览器的 Ctrl+加号/减号 效果一样。"
      >
        <div className={styles.zoomRow}>
          <Button
            icon={<ZoomOut20Regular />}
            disabled={settings.zoom <= 0.7}
            onClick={() => void changeZoom(-0.1)}
            aria-label="缩小"
          />
          <span className={styles.zoomValue}>{Math.round(settings.zoom * 100)}%</span>
          <Button
            icon={<ZoomIn20Regular />}
            disabled={settings.zoom >= 1.5}
            onClick={() => void changeZoom(0.1)}
            aria-label="放大"
          />
          <Button
            icon={<ArrowReset20Regular />}
            disabled={settings.zoom === 1}
            onClick={() => void changeZoom(0)}
          >
            恢复默认
          </Button>
        </div>
      </Field>

      <Field label="深浅色模式">
        <Dropdown
          selectedOptions={[settings.theme]}
          value={THEME_LABELS[settings.theme]}
          onOptionSelect={(_, d) =>
            void changeTheme(d.optionValue as 'system' | 'light' | 'dark')
          }
        >
          <Option value="system">跟随设备</Option>
          <Option value="light">浅色</Option>
          <Option value="dark">深色</Option>
        </Dropdown>
      </Field>

      <div className={styles.sectionTitle}>默认值</div>

      <Field label="最多提问数" hint="范围 0 到 5。填 0 表示从不提问，直接出结果。">
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
        label="整理也参考风格样本"
        checked={settings.tidyUseStyleSamples}
        onChange={(_, d) => void patch({ tidyUseStyleSamples: d.checked })}
      />

      <Switch
        label="显示 Token 用量"
        checked={settings.showTokenUsage}
        onChange={(_, d) => void patch({ showTokenUsage: d.checked })}
      />

      <div className={styles.sectionTitle}>高级</div>

      <Field hint="打开后会记录请求内容，方便排查问题。日志里的 API Key 一律打码。">
        <Switch
          label="调试日志"
          checked={settings.debugLog}
          onChange={(_, d) => void patch({ debugLog: d.checked })}
        />
      </Field>

      <div className={styles.hint}>
        日志文件位置：
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
