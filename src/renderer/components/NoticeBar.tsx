import type { JSX } from 'react'
import { MessageBar, MessageBarBody, MessageBarActions, Button, makeStyles } from '@fluentui/react-components'
import { Dismiss16Regular } from '@fluentui/react-icons'
import { useStore } from '../store'

const useStyles = makeStyles({
  root: {
    margin: '8px 12px 0'
  }
})

export function NoticeBar(): JSX.Element | null {
  const styles = useStyles()
  const { notice, setNotice } = useStore()

  if (!notice) return null

  const intent = notice.kind === 'warning' ? 'warning' : notice.kind === 'success' ? 'success' : 'info'

  return (
    <MessageBar className={styles.root} intent={intent}>
      <MessageBarBody>{notice.text}</MessageBarBody>
      <MessageBarActions
        containerAction={
          <Button
            appearance="transparent"
            icon={<Dismiss16Regular />}
            onClick={() => setNotice(null)}
            aria-label="关闭提示"
          />
        }
      />
    </MessageBar>
  )
}
