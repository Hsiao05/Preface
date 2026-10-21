import { useCallback, useEffect, useState } from 'react'
import type { PromptOverrides } from '../shared/buildMessages'
import type { BlockId } from '../shared/prompts/blocks'
import type { StyleItemView } from '../preload/index'

/**
 * 把设置里的提示词配置读成 buildMessages 能用的覆盖项。
 *
 * 只在用户改过内置内容时才覆盖；没改过的项保持 undefined，
 * 让 buildMessages 用代码里的内置版本（这样软件升级能拿到新内容）。
 */

/** 从设置项列表里算出覆盖项 */
export function toOverrides(items: StyleItemView[]): PromptOverrides {
  const overrides: PromptOverrides = {
    blocks: {},
    templates: {},
    styles: {},
    styleSamples: {}
  }

  for (const item of items) {
    if (item.kind === 'block') {
      // 用户改过的块才覆盖
      if (item.edited) {
        overrides.blocks![item.id as BlockId] = item.text
      }
    } else if (item.kind === 'template') {
      if (
        item.edited &&
        (item.id === 'tidy' ||
          item.id === 'title' ||
          item.id === 'translate' ||
          item.id === 'expression')
      ) {
        overrides.templates![item.id] = item.text
      }
    } else if (item.kind === 'style') {
      // 风格文字：用户改过的才覆盖
      if (item.edited) {
        overrides.styles![item.id] = item.text
      }
      // 样本：有就传
      if (item.samples && item.samples.length > 0) {
        overrides.styleSamples![item.id] = item.samples
      }
    } else if (item.kind === 'extra') {
      overrides.extra = item.text
    }
  }

  return overrides
}

/**
 * 读取并缓存提示词覆盖项。
 * 设置页保存后广播事件，这里会重新读。
 */
export function usePromptOverrides(): {
  overrides: PromptOverrides
  reload: () => void
} {
  const [overrides, setOverrides] = useState<PromptOverrides>({})

  const reload = useCallback(() => {
    void window.preface.listStyles().then((data) => {
      setOverrides(toOverrides(data.items))
    })
  }, [])

  useEffect(() => {
    reload()
    window.addEventListener('preface:styles-changed', reload)
    return () => window.removeEventListener('preface:styles-changed', reload)
  }, [reload])

  return { overrides, reload }
}

/** 取某个风格的显示名（用于顶栏下拉框） */
export function styleNameOf(items: StyleItemView[], id: string): string {
  return items.find((i) => i.id === id && i.kind === 'style')?.name ?? id
}
