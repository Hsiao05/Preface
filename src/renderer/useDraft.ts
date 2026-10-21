import { useEffect, useRef } from 'react'
import { useStore } from './store'
import { translate } from '../shared/i18n'

const SAVE_DELAY = 1000

/**
 * 草稿的自动保存与恢复。
 *
 * 规则（文档第九节）：
 * - 停止输入 1 秒后自动保存
 * - 窗口隐藏时和程序退出前立即保存
 * - 未复制时，隐藏再呼出原样恢复
 * - 复制后，下次呼出换成一张新草稿，但可以恢复上一次的内容
 */
export function useDraftPersistence(): void {
  const draft = useStore((s) => s.draft)
  const loaded = useStore((s) => s.loaded)
  const setPrevious = useStore((s) => s.setPrevious)
  const setLoaded = useStore((s) => s.setLoaded)
  const setNotice = useStore((s) => s.setNotice)
  const resetDraft = useStore((s) => s.resetDraft)

  // 最近一次保存的草稿内容，用来避免无变化时的重复写入
  const lastSaved = useRef<string>('')

  // ---------- 启动时加载 ----------
  useEffect(() => {
    let cancelled = false

    void (async () => {
      const [saved, previous] = await Promise.all([
        window.preface.loadDraft(),
        window.preface.loadPreviousDraft()
      ])
      if (cancelled) return

      if (saved) {
        useStore.getState().replaceDraft(saved)
        lastSaved.current = JSON.stringify(saved)
      }
      if (previous && !previous.expired) {
        setPrevious(previous)
      }
      setLoaded(true)
    })()

    return () => {
      cancelled = true
    }
  }, [setPrevious, setLoaded])

  // ---------- 防抖自动保存 ----------
  useEffect(() => {
    if (!loaded) return

    const serialized = JSON.stringify(draft)
    if (serialized === lastSaved.current) return

    const timer = setTimeout(() => {
      lastSaved.current = serialized
      void window.preface.saveDraft(draft)
    }, SAVE_DELAY)

    return () => clearTimeout(timer)
  }, [draft, loaded])

  // ---------- 窗口隐藏时立即保存 ----------
  useEffect(() => {
    const handler = (): void => {
      void window.preface.saveDraft(useStore.getState().draft)
    }
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) handler()
    })
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  // ---------- 窗口重新显示时：如果是复制过的草稿，换新草稿 ----------
  useEffect(() => {
    const unsubscribe = window.preface.onWindowShown(() => {
      const state = useStore.getState()
      if (state.draft.status !== 'copied') return

      // 复制过的草稿已经存进 previous，这里换一张新的
      resetDraft()
      const previous = state.previous
      if (previous && !previous.expired) {
        setNotice({
          kind: 'info',
          text: translate(
            state.uiLanguage,
            'notice.previousAvailable'
          )
        })
      }
    })
    return unsubscribe
  }, [resetDraft, setNotice])
}

/** 恢复上一次已复制的草稿 */
export async function restorePreviousDraft(): Promise<boolean> {
  const state = useStore.getState()
  const previous = state.previous
  if (!previous) return false

  state.replaceDraft(previous.draft)
  state.setActiveTab('source')
  return true
}
