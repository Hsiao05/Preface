import { useState, type JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Radio,
  RadioGroup,
  makeStyles,
  tokens
} from '@fluentui/react-components'
import type { PreCopyIssue } from '../../shared/preCopyCheck'

const useStyles = makeStyles({
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxHeight: '50vh',
    overflowY: 'auto'
  },
  issue: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  },
  title: {
    fontWeight: tokens.fontWeightSemibold
  },
  detail: {
    color: tokens.colorNeutralForeground2,
    lineHeight: '1.6'
  }
})

interface Props {
  open: boolean
  issues: PreCopyIssue[]
  onCancel: () => void
  onConfirm: (includeUnreferenced: boolean) => void
}

export function CopyIssuesDialog({ open, issues, onCancel, onConfirm }: Props): JSX.Element {
  const styles = useStyles()
  // 未被引用的资料要不要附带，默认附带
  const [includeUnreferenced, setIncludeUnreferenced] = useState('yes')

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onCancel()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>复制前请确认</DialogTitle>
          <DialogContent className={styles.content}>
            {issues.map((issue, index) => (
              <div key={index} className={styles.issue}>
                <div className={styles.title}>· {issue.title}</div>
                <div className={styles.detail}>{issue.detail}</div>

                {issue.kind === 'unreferenced' && (
                  <RadioGroup
                    value={includeUnreferenced}
                    onChange={(_, data) => setIncludeUnreferenced(data.value)}
                  >
                    <Radio value="yes" label="附带，标注为背景资料" />
                    <Radio value="no" label="不附带，本次略去" />
                  </RadioGroup>
                )}
              </div>
            ))}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onCancel}>
              返回修改
            </Button>
            <Button
              appearance="primary"
              onClick={() => onConfirm(includeUnreferenced === 'yes')}
            >
              仍然复制
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
