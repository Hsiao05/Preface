/**
 * 内置表达风格。说明文字原样作为块 6 放进系统提示词。
 * 每条都在 80 字以内，因为它每次调用都会发送。
 * 文字必须与 docs/SPEC.md 第八节完全一致。
 */

export interface BuiltinStyle {
  id: string
  name: string
  /** 适用场景，只用于界面显示，不进提示词 */
  scene: string
  /** 块 6 的内容 */
  text: string
}

export const BUILTIN_STYLES: BuiltinStyle[] = [
  {
    id: 'clear-direct',
    name: '清晰直接',
    scene: '大多数情况',
    text: '用平实、直接的句子，每句只说一件事，先说动作再说原因。少用形容词和客套话，不加用户没有的强调。'
  },
  {
    id: 'rigorous',
    name: '严谨周密',
    scene: '正式文档、学术、法务、合同',
    text: '用词准确、无歧义。写明范围、前提和例外；区分"必须"和"可以"；数字、日期、名称原样引用。语气正式、克制。'
  },
  {
    id: 'concise',
    name: '简洁精炼',
    scene: '熟悉的任务，想快速下指令',
    text: '只保留完成任务必需的信息，合并同类要求，去掉铺垫和解释。越短越好，但不能丢掉用户的任何要求。'
  },
  {
    id: 'detailed',
    name: '详尽引导',
    scene: '复杂任务，或者 Agent 需要更多指引',
    text: '对关键步骤给出判断标准和理由。在容易出错或需要取舍的地方，要求 Agent 先说明打算怎么做，确认后再继续。'
  },
  {
    id: 'collaborative',
    name: '协作商量',
    scene: '开放性任务，需要 Agent 出主意',
    text: '语气温和，像和可靠的同事商量。说明用户的想法和顾虑，并邀请 Agent 发现问题时提出不同意见或替代方案。'
  },
  {
    id: 'my-style',
    name: '我的风格',
    scene: '想让结果像自己写的',
    text: '以风格样本为准，模仿它的句式、编号习惯、连接词、语气和详略，不采用样本中的具体内容。'
  }
]

/** "我的风格"没有样本时不可选 */
export const MY_STYLE_ID = 'my-style'

export const DEFAULT_STYLE_ID = 'clear-direct'

export function findBuiltinStyle(id: string): BuiltinStyle | undefined {
  return BUILTIN_STYLES.find((s) => s.id === id)
}
