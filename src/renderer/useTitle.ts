import { useCallback, useRef, useState } from 'react'
import { useStore } from './store'
import { useLlmRun } from './useLlmRun'
import { buildTitleMessages } from '../shared/buildMessages'
import { buildPromptTitleMessages } from '../shared/promptLibrary'
import { toOverrides } from './usePromptOverrides'
import { useT } from './i18n'

/**
 * 给语料生成标题（文档第七节的模板 E）。
 *
 * 只在用户点"AI总结标题"或语料卡片上的"生成标题"时调用。
 * 优化时的标题由首轮调用顺带生成，不走这里。
 *
 * 这里只管"发起、取消、拿到结果"，**是否写回由调用方决定** ——
 * 调用方持有编辑上下文，只有它知道结果是不是已经过期了。
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

/** 给 Prompt 库条目起标题时，模型返回的标题可以稍长一些 */
export function cleanPromptTitle(raw: string, max = 20): string {
  const firstLine = raw.trim().split(/\r?\n/)[0] ?? ''
  return firstLine
    .trim()
    .replace(/^["'“”‘’《【\[]+/, '')
    .replace(/["'“”‘’》】\]]+$/, '')
    .replace(/[。，、；：！？.,;:!?]+$/, '')
    .trim()
    .slice(0, max)
}

export function useTitle(): {
  /** 为一段文字生成标题 */
  generate: (content: string) => Promise<string | null>
  /** 为 Prompt 库条目生成"适用场景"标题 */
  generateForPrompt: (content: string) => Promise<string | null>
  generating: boolean
  /** 取消在途的生成。已有标题不会被清掉。 */
  cancel: () => void
} {
  const [generating, setGenerating] = useState(false)
  const t = useT()
  const { run, cancel: cancelRun } = useLlmRun()
  // 每次生成 +1，旧请求的 finally 不能把新请求的 loading 清掉
  const generationRef = useRef(0)

  const start = useCallback(
    async (
      kind: 'title',
      messages: Array<{ role: 'system' | 'user'; content: string }>,
      clean: (raw: string) => string,
      emptyMessage: string
    ): Promise<string | null> => {
      const generation = generationRef.current + 1
      generationRef.current = generation
      setGenerating(true)

      try {
        let finalText = ''

        const outcome = await run(kind, messages, {
          trackStream: false,
          onDone: (text) => {
            finalText = text
          }
        })

        // 被取消、失败，或者期间又发起了新的一次：都不回填
        if (outcome === null) return null
        if (generation !== generationRef.current) return null

        const cleaned = clean(finalText)
        if (!cleaned) {
          useStore.getState().setNotice({ kind: 'warning', text: emptyMessage })
          return null
        }
        return cleaned
      } finally {
        // 只有最后一次请求负责关掉 loading
        if (generation === generationRef.current) setGenerating(false)
      }
    },
    [run]
  )

  const generate = useCallback(
    async (content: string): Promise<string | null> => {
      if (!content.trim()) return null

      const stylesData = await window.preface.listStyles()
      const overrides = toOverrides(stylesData.items)

      return start(
        'title',
        buildTitleMessages(content, overrides),
        cleanTitle,
        t('title.empty')
      )
    },
    [start, t]
  )

  const generateForPrompt = useCallback(
    async (content: string): Promise<string | null> => {
      if (!content.trim()) return null

      return start(
        'title',
        buildPromptTitleMessages(content),
        (raw) => cleanPromptTitle(raw),
        t('title.empty')
      )
    },
    [start, t]
  )

  const cancel = useCallback((): void => {
    // 让这一次的结果作废，并取消主进程里的请求
    generationRef.current += 1
    // 标题是用户自己动手才作废的，不用弹「已取消。」
    cancelRun(true)
    setGenerating(false)
  }, [cancelRun])

  return { generate, generateForPrompt, generating, cancel }
}
