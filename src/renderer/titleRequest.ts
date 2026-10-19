/**
 * 「AI 总结标题」的请求隔离。
 *
 * 【要解决的问题】旧实现拿到结果就无条件 `setTitle(result)`。于是：
 * - 生成期间用户自己改了标题，迟到的 AI 结果把手写内容覆盖掉；
 * - 生成期间关掉窗口、换到另一份语料，旧结果会写进新的编辑窗口。
 *
 * 每次发起生成时记下一枚令牌（请求代次 + 编辑对象 + 编辑修订号）。
 * 手动改标题、改正文、关闭、切换语料都会让令牌失效，迟到的结果不再回填。
 * 用户重新点「AI总结标题」就是一次新请求，不会被"曾经手改过"永久挡住。
 */

export interface TitleRequestToken {
  /** 每次发起生成 +1 */
  requestId: number
  /** 正在编辑的语料 id；新建语料为空字符串 */
  editingKey: string
  /** 标题或正文被用户改过的次数 */
  revision: number
}

export interface TitleRequestState extends TitleRequestToken {}

/** 新建一份初始状态 */
export function createTitleState(editingKey = ''): TitleRequestState {
  return { requestId: 0, editingKey, revision: 0 }
}

/** 用户改了标题或正文：让在途请求作废 */
export function touchTitleState(state: TitleRequestState): TitleRequestState {
  return { ...state, revision: state.revision + 1 }
}

/** 关闭窗口或换了一份语料：让在途请求作废 */
export function rebindTitleState(state: TitleRequestState, editingKey: string): TitleRequestState {
  return { requestId: state.requestId + 1, editingKey, revision: state.revision + 1 }
}

/** 发起一次新请求，拿到令牌 */
export function beginTitleRequest(state: TitleRequestState): {
  state: TitleRequestState
  token: TitleRequestToken
} {
  const next = { ...state, requestId: state.requestId + 1 }
  return {
    state: next,
    token: {
      requestId: next.requestId,
      editingKey: next.editingKey,
      revision: next.revision
    }
  }
}

/** 迟到的结果还能不能写回输入框 */
export function shouldApplyTitle(
  token: TitleRequestToken,
  current: TitleRequestState
): boolean {
  return (
    token.requestId === current.requestId &&
    token.editingKey === current.editingKey &&
    token.revision === current.revision
  )
}

/**
 * 用户手改标题后的来源。
 * 清空标题时回到 none；有内容就是用户自己填的。
 */
export function titleSourceAfterEdit(title: string): 'user' | 'none' {
  return title.trim() ? 'user' : 'none'
}
