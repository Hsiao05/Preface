import type { JSX } from 'react'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle
} from '@fluentui/react-components'
import { useStore } from '../store'
import { useT } from '../i18n'
import type { ProtectedTokenIssue } from '../../shared/protectedTokens'

interface Props {
  open: boolean
  issues: ProtectedTokenIssue[]
  onCancel: () => void
  onConfirm: () => void
}

/** 翻译、整理和优化表达共用：命令或 @ 引用有变化时，先让用户确认。 */
export function ProtectedReplaceDialog({
  open,
  issues,
  onCancel,
  onConfirm
}: Props): JSX.Element {
  const t = useT()
  const language = useStore((s) => s.uiLanguage)
  const separator = language === 'en' ? ', ' : '、'

  const lines = issues.map((issue) => {
    const tokens = issue.tokens.join(separator)
    switch (issue.kind) {
      case 'missing-command':
        return t('protected.missingCommands', { tokens })
      case 'extra-command':
        return t('protected.extraCommands', { tokens })
      case 'missing-ref':
        return t('protected.missingRefs', { tokens })
      case 'extra-ref':
        return t('protected.extraRefs', { tokens })
    }
  })

  return (
    <Dialog open={open} onOpenChange={(_, data) => !data.open && onCancel()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t('protected.title')}</DialogTitle>
          <DialogContent>
            {lines.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
            <div style={{ marginTop: '8px' }}>{t('protected.note')}</div>
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button appearance="primary" onClick={onConfirm}>
              {t('protected.confirm')}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  )
}
