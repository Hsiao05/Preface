import { useEffect, useState, type JSX } from 'react'
import { makeStyles, tokens } from '@fluentui/react-components'

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
  const [version, setVersion] = useState('')
  const [logPath, setLogPath] = useState('')

  useEffect(() => {
    void window.preface.getVersion().then(setVersion)
    void window.preface.getLogPath().then(setLogPath)
  }, [])

  return (
    <div className={styles.section}>
      <div className={styles.title}>关于</div>

      <div className={styles.line}>
        <span className={styles.label}>版本：</span>
        {version || '读取中'}
      </div>

      <div className={styles.line}>
        <span className={styles.label}>日志文件：</span>
        <div className={styles.code}>{logPath}</div>
      </div>

      <div className={styles.line}>
        <span className={styles.label}>数据位置：</span>
        <div className={styles.code}>与日志文件同一目录（上两级）</div>
      </div>

      <div className={styles.line}>
        本程序不会读取你上传文件的内容，只记录路径和元信息。
      </div>
    </div>
  )
}
