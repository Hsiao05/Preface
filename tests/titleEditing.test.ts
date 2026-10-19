import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  beginTitleRequest,
  createTitleState,
  rebindTitleState,
  shouldApplyTitle,
  titleSourceAfterEdit,
  touchTitleState
} from '../src/renderer/titleRequest'

/**
 * 语料标题的可编辑性（回归测试）。
 *
 * 【用户报的问题】编辑语料时，点过「AI总结标题」之后就改不了标题了。
 *
 * 根因有两层：
 * 1. CorpusDialog 拿到结果就 `setTitle(result)`，不看用户有没有在生成期间改过、
 *    也不看窗口是不是已经换成另一份语料。迟到的结果会覆盖后来的输入。
 * 2. useTitle 没有把取消暴露给调用方，生成中用户没有任何办法让它停下来。
 *
 * 这里锁住"什么情况下迟到的结果不能回填"，并检查对话框确实用了这套判定。
 */

describe('标题请求令牌', () => {
  it('发起生成后，没有别的动作时结果可以回填', () => {
    const { state, token } = beginTitleRequest(createTitleState('C1'))
    expect(shouldApplyTitle(token, state)).toBe(true)
  })

  it('生成期间用户手改了标题：迟到的结果不能覆盖', () => {
    const { state, token } = beginTitleRequest(createTitleState('C1'))
    const edited = touchTitleState(state)

    expect(shouldApplyTitle(token, edited)).toBe(false)
  })

  it('生成期间用户改了正文：标题的依据变了，结果作废', () => {
    const { state, token } = beginTitleRequest(createTitleState('C1'))
    expect(shouldApplyTitle(token, touchTitleState(state))).toBe(false)
  })

  it('生成期间关闭再打开另一份语料：旧结果不能写进新的编辑窗口', () => {
    const { state, token } = beginTitleRequest(createTitleState('C1'))
    const reopened = rebindTitleState(state, 'C2')

    expect(shouldApplyTitle(token, reopened)).toBe(false)
  })

  it('关闭对话框（同一份语料）：旧结果也不能回填', () => {
    const { state, token } = beginTitleRequest(createTitleState('C1'))
    const closed = rebindTitleState(state, 'C1')

    expect(shouldApplyTitle(token, closed)).toBe(false)
  })

  it('用户再次点「AI总结标题」：新请求可以正常回填', () => {
    // 第一次请求被手改作废
    const first = beginTitleRequest(createTitleState('C1'))
    const edited = touchTitleState(first.state)
    expect(shouldApplyTitle(first.token, edited)).toBe(false)

    // 再次点击就是新请求，不能因为"曾经手改过"永久挡住
    const second = beginTitleRequest(edited)
    expect(shouldApplyTitle(second.token, second.state)).toBe(true)
  })

  it('两个请求逆序返回：先发的那一个不会覆盖后发的', () => {
    const first = beginTitleRequest(createTitleState('C1'))
    const second = beginTitleRequest(first.state)

    // 第二个（较新的）先回来
    expect(shouldApplyTitle(second.token, second.state)).toBe(true)
    // 第一个迟到
    expect(shouldApplyTitle(first.token, second.state)).toBe(false)
  })

  it('手改标题后的来源：有内容算 user，清空算 none', () => {
    expect(titleSourceAfterEdit('我自己起的')).toBe('user')
    expect(titleSourceAfterEdit('   ')).toBe('none')
  })
})

describe('对话框与 useTitle 的实现约束', () => {
  const root = join(__dirname, '..')
  const dialog = readFileSync(
    join(root, 'src/renderer/components/CorpusDialog.tsx'),
    'utf-8'
  )
  const useTitle = readFileSync(join(root, 'src/renderer/useTitle.ts'), 'utf-8')
  const topbar = readFileSync(join(root, 'src/renderer/components/TopBar.tsx'), 'utf-8')
  const actions = readFileSync(join(root, 'src/renderer/corpusActions.ts'), 'utf-8')

  it('标题输入框始终可编辑（没有 readOnly / disabled）', () => {
    const input = dialog.slice(dialog.indexOf('<Input'), dialog.indexOf('placeholder="例如：客户口头反馈整理"'))
    expect(input).not.toContain('readOnly')
    expect(input).not.toContain('disabled')
  })

  it('AI 结果回填前必须核对请求令牌', () => {
    expect(dialog).toContain('shouldApplyTitle(token, titleStateRef.current)')
  })

  it('手改标题会作废在途请求，而不是被旧结果盖回去', () => {
    expect(dialog).toContain('titleStateRef.current = touchTitleState(titleStateRef.current)')
  })

  it('useTitle 提供取消能力', () => {
    expect(useTitle).toContain('cancel: () => void')
    expect(useTitle).toContain('cancelRun(true)')
  })

  it('保存时传递真实标题来源，而不是一律当成 user', () => {
    expect(topbar).toContain('titleSource,')
    expect(actions).toContain('titleSource?: TitleSource')
  })
})
