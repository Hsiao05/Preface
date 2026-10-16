import { useCallback, useState } from 'react'
import { useStore } from './store'
import { useLlmRun } from './useLlmRun'
import { buildTitleMessages } from '../shared/buildMessages'
import { toOverrides } from './usePromptOverrides'

/**
 * 给语料生成标题（文档第七节的模板 E）。
 *
 * 只在用户点"AI总结标题"或语料卡片上的"生成标题"时调用。
 * 优化时的标题由首轮调用顺带生成，不走这里。
 */

/** 清理模型返回的标题：去掉引号、空白，超过 20 字截断 */
export function cleanTitle(raw: string): string {
  return raw
    .trim()
    .replace(/^["'“”‘’《【\[]+/, '')
    .replace(/["'“”‘’》】\]]+$/, '')
    .replace(/[。，、；：！？.,;:!?]+$/, '')
    .trim()
    .slice(0, 20)
}

export function useTitle(): {
  /** 为一段文字生成标题 */
  generate: (content: string) => Promise<string | null>
  generating: boolean
} {
  const [generating, setGenerating] = useState(false)
  const { run } = useLlmRun()

  const generate = useCallback(
    async (content: string): Promise<string | null> => {
      if (!content.trim()) return null

      setGenerating(true)
      try {
        let finalText = ''

        const stylesData = await window.preface.listStyles()
        const overrides = toOverrides(stylesData.items)

        const outcome = await run('title', buildTitleMessages(content, overrides), {
          trackStream: false,
          onDone: (text) => {
            finalText = text
          }
        })

        if (outcome === null) return null

        const cleaned = cleanTitle(finalText)
        if (!cleaned) {
          useStore.getState().setNotice({
            kind: 'warning',
            text: '模型没有返回标题，请手动填写。'
          })
          return null
        }
        return cleaned
      } finally {
        setGenerating(false)
      }
    },
    [run]
  )

  return { generate, generating }
}
