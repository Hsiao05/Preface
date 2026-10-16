import { forwardRef, useEffect, useImperativeHandle, useRef, type JSX } from 'react'
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Range
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  keymap,
  placeholder,
  type DecorationSet
} from '@codemirror/view'
import {
  autocompletion,
  closeBrackets,
  completionKeymap,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { makeStyles, tokens } from '@fluentui/react-components'
import { REF_PATTERN } from '../../shared/refs'

const useStyles = makeStyles({
  root: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    // 用 Background3 而不是 Background1：深色下 Background1 和面板同色，
    // 输入区看起来是一片死平的灰，没有"这里可以打字"的感觉
    backgroundColor: tokens.colorNeutralBackground3,
    '& .cm-editor': {
      height: '100%',
      fontSize: tokens.fontSizeBase300,
      fontFamily: tokens.fontFamilyBase
    },
    '& .cm-editor.cm-focused': { outline: 'none' },
    '& .cm-scroller': {
      fontFamily: tokens.fontFamilyBase,
      lineHeight: '1.7',
      padding: '4px 0'
    },
    // 底部留出空间给浮在右下角的麦克风按钮，免得它盖住最后一行文字
    '& .cm-content': { padding: '8px 12px 44px' },
    '& .cm-line': { padding: '0' }
  }
})

/** 更新引用装饰的效果 */
const setRefDecorations = StateEffect.define<{ broken: Set<string> }>()

/** 把正文里的 @F1 显示成小标签，失效的标红 */
const refDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(value, transaction) {
    let broken: Set<string> | null = null
    for (const effect of transaction.effects) {
      if (effect.is(setRefDecorations)) {
        broken = effect.value.broken
      }
    }

    // 文档或失效集合变化时重新计算
    if (!transaction.docChanged && broken === null) {
      return value.map(transaction.changes)
    }

    const decorations: Range<Decoration>[] = []
    const text = transaction.state.doc.toString()
    const pattern = new RegExp(REF_PATTERN.source, 'g')
    let match: RegExpExecArray | null

    while ((match = pattern.exec(text)) !== null) {
      const id = match[0].slice(1)
      const isBroken = broken ? broken.has(id) : false
      decorations.push(
        Decoration.mark({
          class: isBroken ? 'cm-broken-ref' : 'cm-ref-tag',
          attributes: { 'data-ref': match[0] }
        }).range(match.index, match.index + match[0].length)
      )
    }

    return Decoration.set(decorations, true)
  },
  provide: (field) => EditorView.decorations.from(field)
})

/**
 * 编辑器主题。
 *
 * 【为什么必须用 CodeMirror 的 theme API】
 * CodeMirror 会把自己的样式注入到 <head> 里，并且用它自己的 &dark / &light
 * 两套选择器切换。写在 index.css 里的规则会被它的注入样式盖掉 ——
 * 这就是"深色下原文光标看不见"的原因。
 *
 * 用 theme + darkTheme facet，样式才会真正生效。
 */
function editorTheme(isDark: boolean): Extension {
  return [
    EditorView.theme(
      {
        // 浅色下的光标：深灰，比默认的 1.2px 黑线更清楚
        '.cm-cursor, .cm-dropCursor': {
          borderLeftColor: isDark ? '#ffffff' : '#242424',
          borderLeftWidth: '2px'
        },
        '&.cm-focused .cm-cursor': {
          borderLeftColor: isDark ? '#ffffff' : '#242424'
        },
        // 失焦时的光标淡一点，但仍然可见
        '.cm-cursor-secondary': {
          borderLeftColor: isDark ? '#a0a0a0' : '#8a8a8a'
        },
        // 选中文字
        '.cm-selectionBackground, ::selection': {
          backgroundColor: isDark ? '#264f78' : '#b4d7f5'
        },
        '&.cm-focused .cm-selectionBackground': {
          backgroundColor: isDark ? '#2d5f8a' : '#a3cef0'
        },
        // 编辑器背景：深色下略深于面板，让它像个输入区域
        '&': {
          backgroundColor: isDark ? '#1b1b1b' : 'transparent',
          color: isDark ? '#e6e6e6' : '#242424'
        },
        // 输入法组字时的下划线
        '.cm-composition': {
          borderBottomColor: isDark ? '#ffffff' : '#242424'
        },
        // 自动补全弹层
        '.cm-tooltip': {
          backgroundColor: isDark ? '#2b2b2b' : '#ffffff',
          borderColor: isDark ? '#4d4d4d' : '#d1d1d1',
          color: isDark ? '#e6e6e6' : '#242424'
        },
        '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
          backgroundColor: isDark ? '#0f548c' : '#e5f1fb',
          color: isDark ? '#ffffff' : '#0f548c'
        }
      },
      { dark: isDark }
    ),
    // 告诉 CodeMirror 现在是深色，它的内置样式（&dark 那套）才会生效
    EditorView.darkTheme.of(isDark)
  ]
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** 已知的资料编号 → 显示名，用于 @ 补全 */
  resources: Array<{ id: string; label: string; kind: 'file' | 'corpus' }>
  /** 失效的引用编号 */
  brokenRefs: Set<string>
  /** 外部要求聚焦时递增这个值 */
  focusSignal: number
  /** 当前是不是深色模式 */
  isDark?: boolean
  onCaretChange?: (pos: number) => void
}

/** 编辑器对外暴露的方法 */
export interface IntentEditorHandle {
  /**
   * 在当前光标处插入文字。
   * 如果当前有选中内容，就替换选中的部分。
   * 整次插入是一步撤销操作。
   */
  insertAtCursor: (text: string) => void
}

export const IntentEditor = forwardRef<IntentEditorHandle, Props>(function IntentEditor(
  { value, onChange, resources, brokenRefs, focusSignal, isDark = false, onCaretChange },
  ref
): JSX.Element {
  const styles = useStyles()
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  // 主题单独放一个 Compartment，切换时不用重建整个编辑器
  const themeCompartment = useRef(new Compartment())
  // 用 ref 保存最新值，避免每次资料变化都重建编辑器
  const resourcesRef = useRef(resources)
  const onChangeRef = useRef(onChange)

  resourcesRef.current = resources
  onChangeRef.current = onChange

  // ---------- 创建编辑器 ----------
  useEffect(() => {
    if (!containerRef.current) return

    /** @ 补全：列出全部资料，可按编号或名称过滤 */
    const refCompletion = (context: CompletionContext): CompletionResult | null => {
      const before = context.matchBefore(/@[A-Za-z0-9]*/)
      if (!before) return null
      if (before.from === before.to && !context.explicit) return null

      const typed = before.text.slice(1).toLowerCase()
      const options = resourcesRef.current
        .filter(
          (r) =>
            typed === '' ||
            r.id.toLowerCase().includes(typed) ||
            r.label.toLowerCase().includes(typed)
        )
        .map((r) => ({
          label: `@${r.id}`,
          detail: r.label,
          type: r.kind === 'file' ? 'variable' : 'text',
          apply: `@${r.id} `
        }))

      if (options.length === 0) return null
      return { from: before.from, to: before.to, options }
    }

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        closeBrackets(),
        autocompletion({
          override: [refCompletion],
          activateOnTyping: true,
          icons: false
        }),
        keymap.of([...completionKeymap, ...historyKeymap, ...defaultKeymap]),
        placeholder('写下你的需求。输入 @ 可以引用资料。'),
        EditorView.lineWrapping,
        themeCompartment.current.of(editorTheme(isDark)),
        refDecorationField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
          if (update.selectionSet || update.docChanged) {
            onCaretChange?.(update.state.selection.main.head)
          }
        })
      ]
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只在挂载时创建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- 把资料标签拖进来，在落点插入 @编号 ----------
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const isRefDrag = (event: DragEvent): boolean =>
      Boolean(event.dataTransfer?.types.includes('application/x-preface-ref'))

    const handleDragOver = (event: DragEvent): void => {
      if (!isRefDrag(event)) return
      // 必须 preventDefault，否则浏览器不会触发 drop
      event.preventDefault()
      event.stopPropagation()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    const handleDrop = (event: DragEvent): void => {
      if (!isRefDrag(event)) return
      // 用捕获阶段拦住，别让 CodeMirror 内置的 drop 处理器再插一次
      event.preventDefault()
      event.stopPropagation()

      const id = event.dataTransfer?.getData('application/x-preface-ref')
      const view = viewRef.current
      if (!id || !view) return

      // 算出鼠标落在文档的哪个位置，把引用插进去
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.doc.length
      const text = `@${id} `

      view.dispatch({
        changes: { from: pos, insert: text },
        selection: { anchor: pos + text.length }
      })
      view.focus()
    }

    // 捕获阶段（第三个参数 true）：先于 CodeMirror 自己的处理器执行
    container.addEventListener('dragover', handleDragOver, true)
    container.addEventListener('drop', handleDrop, true)
    return () => {
      container.removeEventListener('dragover', handleDragOver, true)
      container.removeEventListener('drop', handleDrop, true)
    }
  }, [])

  // ---------- 外部值变化时同步（例如撤销整理、恢复草稿） ----------
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return

    view.dispatch({
      changes: { from: 0, to: current.length, insert: value }
    })
  }, [value])

  // ---------- 对外暴露插入方法 ----------
  useImperativeHandle(
    ref,
    () => ({
      insertAtCursor: (text: string) => {
        const view = viewRef.current
        if (!view || !text) return

        const { from, to } = view.state.selection.main
        // 有选中内容就替换，否则在光标处插入。
        // 整次 dispatch 是一步撤销操作，Ctrl+Z 一次就能撤回。
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
          // 标记成用户输入，这样撤销历史里会记成一步
          userEvent: 'input.voice'
        })
        view.focus()
      }
    }),
    []
  )

  // ---------- 深浅色变化时换主题 ----------
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.current.reconfigure(editorTheme(isDark))
    })
  }, [isDark])

  // ---------- 失效引用变化时更新装饰 ----------
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setRefDecorations.of({ broken: brokenRefs }) })
  }, [brokenRefs])

  // ---------- 聚焦 ----------
  useEffect(() => {
    if (focusSignal > 0) viewRef.current?.focus()
  }, [focusSignal])

  return <div ref={containerRef} className={styles.root} />
})

export { useStyles as useEditorStyles }
