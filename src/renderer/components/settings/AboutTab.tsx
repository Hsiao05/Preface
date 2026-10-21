import { useEffect, useState, type JSX } from 'react'
import { makeStyles, tokens } from '@fluentui/react-components'
import { useT } from '../../i18n'

const useStyles = makeStyles({
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    paddingTop: '4px'
  },
  title: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400
  },
  line: {
    fontSize: tokens.fontSizeBase300,
    lineHeight: '1.8'
  },
  label: {
    color: tokens.colorNeutralForeground3
  },
  code: {
    wordBreak: 'break-all',
    fontSize: tokens.fontSizeBase200,
    fontFamily: tokens.fontFamilyMonospace
  }
})

export function SettingsAbout(): JSX.Element {
  const styles = useStyles()
  const t = useT()
  const [version, setVersion] = useState('')
  const [logPath, setLogPath] = useState('')

  useEffect(() => {
    void window.preface.getVersion().then(setVersion)
    void window.preface.getLogPath().then(setLogPath)
  }, [])

  return (
    <div className={styles.section}>
      <div className={styles.title}>{t('about.title')}</div>

      <div className={styles.line}>
        <span className={styles.label}>{t('about.version')}</span>
        {version || t('about.reading')}
      </div>

      <div className={styles.line}>
        <span className={styles.label}>{t('about.logFile')}</span>
        <div className={styles.code}>{logPath}</div>
      </div>

      <div className={styles.line}>
        <span className={styles.label}>{t('about.dataLocation')}</span>
        <div className={styles.code}>{t('about.dataLocationValue')}</div>
      </div>

      <div className={styles.line}>{t('about.privacy')}</div>
    </div>
  )
}
