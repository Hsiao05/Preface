import { useCallback, useEffect, useState, type JSX } from 'react'
import {
  Button,
  Dropdown,
  Field,
  Input,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import { Mic20Regular, Stop20Regular } from '@fluentui/react-icons'
import { Recorder } from '../../recorder'
import {
  API_TYPE_KEYS,
  SPEECH_LANGUAGES,
  SPEECH_PRESETS,
  type SpeechApiType,
  type SpeechLanguage
} from '../../../shared/speech'
import { useT } from '../../i18n'
import type { SpeechSettings } from '../../../main/settings'

/**
 * 「语音」设置页。
 *
 * 选择服务商预设会自动填好 Base URL、模型和接口类型；
 * API Key 用 safeStorage 加密保存，和提示词优化的 Key 分开存放。
 */

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    paddingTop: '4px'
  },
  title: {
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
    gap: '8px',
    alignItems: 'flex-end'
  },
  grow: {
    flex: 1
  },
  testResult: {
    padding: '10px 12px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word'
  },
  testLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3
  }
})

interface Props {
  onNotice: (n: { text: string; kind: 'info' | 'warning' | 'success' } | null) => void
}

/** 测试录音的时长（秒） */
const TEST_SECONDS = 3

export function SpeechTab({ onNotice }: Props): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const [speech, setSpeech] = useState<SpeechSettings | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyInput, setKeyInput] = useState('')

  // 测试用的状态
  const [testing, setTesting] = useState(false)
  const [testCountdown, setTestCountdown] = useState(0)
  const [testResult, setTestResult] = useState('')
  const [testElapsed, setTestElapsed] = useState<number | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const settings = await window.preface.getSettings()
    setSpeech(settings.speech)
    setHasKey(await window.preface.hasSpeechKey())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  /** 保存某几项 */
  const patch = async (changes: Partial<SpeechSettings>): Promise<void> => {
    const settings = await window.preface.getSettings()
    const next = { ...settings.speech, ...changes }
    setSpeech(next)
    await window.preface.setSettings({ speech: next })
  }

  /** 选预设：自动填好地址、模型、接口类型 */
  const choosePreset = async (presetId: string): Promise<void> => {
    const preset = SPEECH_PRESETS.find((p) => p.id === presetId)
    if (!preset) return

    if (preset.id === 'custom') {
      // 自定义：只记下选择，其他字段不动
      await patch({ preset: preset.id })
      return
    }

    await patch({
      preset: preset.id,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiType: preset.apiType
    })
    onNotice({
      kind: 'success',
      text: t('settings.speech.presetFilled', { name: t(preset.nameKey) })
    })
  }

  /** 保存 API Key */
  const saveKey = async (): Promise<void> => {
    if (!keyInput.trim()) return

    const ok = await window.preface.setSpeechKey(keyInput.trim())
    if (!ok) {
      onNotice({ kind: 'warning', text: t('settings.model.apiKeySaveFailed') })
      return
    }
    setKeyInput('')
    setHasKey(true)
    onNotice({ kind: 'success', text: t('settings.speech.keySaved') })
  }

  /**
   * 测试：录 3 秒并识别。
   *
   * 用和主界面同一套录音与识别代码，确保测出来的就是实际效果。
   */
  const runTest = async (): Promise<void> => {
    if (testing) return

    setTesting(true)
    setTestResult('')
    setTestElapsed(null)
    setTestCountdown(TEST_SECONDS)

    const recorder = new Recorder()

    try {
      await recorder.start()
    } catch (error) {
      setTesting(false)
      setTestCountdown(0)
      onNotice({
        kind: 'warning',
        text: error instanceof Error ? error.message : t('settings.speech.cannotStart')
      })
      return
    }

    // 倒计时
    const timer = setInterval(() => {
      setTestCountdown((n) => Math.max(0, n - 1))
    }, 1000)

    // 录满 3 秒
    await new Promise((resolve) => setTimeout(resolve, TEST_SECONDS * 1000))
    clearInterval(timer)
    setTestCountdown(0)

    let wav: Uint8Array
    try {
      wav = await recorder.stop()
    } catch (error) {
      setTesting(false)
      onNotice({
        kind: 'warning',
        text: t('settings.speech.stopFailed', {
          message: error instanceof Error ? error.message : String(error)
        })
      })
      return
    }

    if (wav.length === 0) {
      setTesting(false)
      onNotice({ kind: 'warning', text: t('settings.speech.noSound') })
      return
    }

    const started = Date.now()
    const result = await window.preface.transcribeAudio(
      wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) as ArrayBuffer
    )
    const elapsed = Date.now() - started

    setTesting(false)
    setTestElapsed(elapsed)

    if (!result.ok) {
      onNotice({
        kind: 'warning',
        text: result.error.suggestion
          ? t('speech.errorWithSuggestion', {
              message: result.error.message,
              suggestion: result.error.suggestion
            })
          : result.error.message
      })
      return
    }

    setTestResult(result.text || t('settings.speech.emptyResult'))
  }

  if (!speech) return <Spinner label={t('settings.speech.loading')} />

  const currentPreset = SPEECH_PRESETS.find((p) => p.id === speech.preset)

  return (
    <div className={styles.section}>
      <div className={styles.title}>{t('settings.speech.title')}</div>
      <div className={styles.hint}>{t('settings.speech.intro')}</div>

      <Field label={t('settings.speech.preset')} hint={t('settings.speech.presetHint')}>
        <Dropdown
          value={
            currentPreset ? t(currentPreset.nameKey) : t('builtin.speech.custom')
          }
          selectedOptions={[speech.preset]}
          onOptionSelect={(_, d) => void choosePreset(d.optionValue as string)}
        >
          {SPEECH_PRESETS.map((preset) => (
            <Option key={preset.id} value={preset.id}>
              {t(preset.nameKey)}
            </Option>
          ))}
        </Dropdown>
      </Field>

      <Field label="Base URL">
        <Input
          value={speech.baseUrl}
          onChange={(_, d) => void patch({ baseUrl: d.value, preset: 'custom' })}
          placeholder={t('settings.speech.baseUrlPlaceholder')}
        />
      </Field>

      <Field
        label="API Key"
        hint={
          hasKey ? t('settings.model.apiKeySet') : t('settings.model.apiKeyUnset')
        }
      >
        <div className={styles.row}>
          <Input
            className={styles.grow}
            type="password"
            value={keyInput}
            onChange={(_, d) => setKeyInput(d.value)}
            placeholder={
              hasKey
                ? t('settings.model.apiKeyPlaceholderSet')
                : t('settings.speech.apiKeyPlaceholderUnset')
            }
          />
          <Button
            appearance="primary"
            disabled={!keyInput.trim()}
            onClick={() => void saveKey()}
          >
            {t('common.save')}
          </Button>
        </div>
      </Field>

      <Field label={t('settings.model.model')}>
        <Input
          value={speech.model}
          onChange={(_, d) => void patch({ model: d.value, preset: 'custom' })}
          placeholder={t('settings.speech.modelPlaceholder')}
        />
      </Field>

      <Field label={t('settings.speech.apiType')}>
        <Dropdown
          value={t(API_TYPE_KEYS[speech.apiType])}
          selectedOptions={[speech.apiType]}
          onOptionSelect={(_, d) =>
            void patch({ apiType: d.optionValue as SpeechApiType, preset: 'custom' })
          }
        >
          <Option value="transcriptions">{t('speech.apiType.transcriptions')}</Option>
          <Option value="chat-audio">{t('speech.apiType.chat-audio')}</Option>
        </Dropdown>
      </Field>

      <Field label={t('settings.speech.language')}>
        <Dropdown
          value={t(
            SPEECH_LANGUAGES.find((l) => l.value === speech.language)?.labelKey ??
              'speech.lang.auto'
          )}
          selectedOptions={[speech.language]}
          onOptionSelect={(_, d) => void patch({ language: d.optionValue as SpeechLanguage })}
        >
          {SPEECH_LANGUAGES.map((lang) => (
            <Option key={lang.value} value={lang.value}>
              {t(lang.labelKey)}
            </Option>
          ))}
        </Dropdown>
      </Field>

      <Field
        label={t('settings.speech.maxSeconds')}
        hint={t('settings.speech.maxSecondsHint')}
      >
        <Input
          type="number"
          value={String(Math.round(speech.maxSeconds / 60))}
          onChange={(_, d) => {
            const minutes = Math.max(0.1, Math.min(30, Number(d.value) || 5))
            void patch({ maxSeconds: Math.round(minutes * 60) })
          }}
        />
      </Field>

      {/* 测试 */}
      <Field
        label={t('settings.speech.test')}
        hint={t('settings.speech.testHint', { seconds: TEST_SECONDS })}
      >
        <div className={styles.row}>
          <Button
            icon={testing ? <Stop20Regular /> : <Mic20Regular />}
            appearance="primary"
            disabled={testing && testCountdown === 0}
            onClick={() => void runTest()}
          >
            {testing
              ? t('settings.speech.recording', { seconds: testCountdown })
              : t('settings.speech.recordTest', { seconds: TEST_SECONDS })}
          </Button>
          {testElapsed !== null && (
            <Text className={styles.testLabel}>
              {t('settings.speech.elapsed', { ms: testElapsed })}
            </Text>
          )}
        </div>
      </Field>

      {testResult && (
        <div>
          <div className={styles.testLabel}>{t('settings.speech.result')}</div>
          <div className={styles.testResult}>{testResult}</div>
        </div>
      )}
    </div>
  )
}
