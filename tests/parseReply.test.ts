import { describe, expect, it } from 'vitest'
import {
  detectStreamPhase,
  extractStreamResult,
  parseReply
} from '../src/shared/parseReply'

/**
 * 行协议解析。
 * 文档第十一节要求至少覆盖：有无【模式】行和【标题】行、【结果】、【提问】、
 * 选项少于 2 个、既无【结果】也无【提问】、前面有多余文字。
 */

describe('需求清楚时（有【结果】）', () => {
  const raw = `【意图】让 Agent 根据客户反馈精简 @F1 第二部分，并调整语气
【模式】简单
【标题】C2=历年访谈全文
【结果】
请帮我修改 @F1 的第二部分。客户反馈这部分太长、语气也不太合适。`

  it('取出意图', () => {
    expect(parseReply(raw).intent).toBe('让 Agent 根据客户反馈精简 @F1 第二部分，并调整语气')
  })

  it('取出模式', () => {
    expect(parseReply(raw).mode).toBe('simple')
  })

  it('取出标题', () => {
    expect(parseReply(raw).titles).toEqual({ C2: '历年访谈全文' })
  })

  it('取出结果正文，不含信息行', () => {
    const result = parseReply(raw).result
    expect(result).toBe(
      '请帮我修改 @F1 的第二部分。客户反馈这部分太长、语气也不太合适。'
    )
    expect(result).not.toContain('【意图】')
    expect(result).not.toContain('【模式】')
  })

  it('没有走兜底', () => {
    expect(parseReply(raw).fellBack).toBe(false)
  })
})

describe('没有【模式】行（用户没选自动）', () => {
  const raw = `【意图】修改文档
【结果】
请修改 @F1。`

  it('mode 为 null', () => {
    expect(parseReply(raw).mode).toBeNull()
  })

  it('结果正常取出', () => {
    expect(parseReply(raw).result).toBe('请修改 @F1。')
  })
})

describe('没有【标题】行', () => {
  const raw = `【意图】修改文档
【模式】简单
【结果】
请修改 @F1。`

  it('titles 为空对象', () => {
    expect(parseReply(raw).titles).toEqual({})
  })
})

describe('多个标题行', () => {
  const raw = `【意图】修改文档
【模式】Markdown
【标题】C1=客户反馈整理
【标题】C2=历年访谈全文
【结果】
请修改 @F1。`

  it('全部解析出来', () => {
    expect(parseReply(raw).titles).toEqual({
      C1: '客户反馈整理',
      C2: '历年访谈全文'
    })
  })
})

describe('模式取 Markdown', () => {
  it('识别 Markdown', () => {
    expect(parseReply('【模式】Markdown\n【结果】\n正文').mode).toBe('markdown')
  })

  it('大小写不敏感', () => {
    expect(parseReply('【模式】markdown\n【结果】\n正文').mode).toBe('markdown')
  })
})

describe('需要澄清时（有【提问】）', () => {
  const raw = `【意图】让 Agent 根据客户反馈修改 @F1
【模式】简单
【提问】
1. 改完之后的语气要偏向哪种？|更正式、克制|更亲切、口语化|保持原来的语气
2. 篇幅大概要压缩多少？|压缩一半左右|只删明显重复的|不限`

  it('解析出两个问题', () => {
    const parsed = parseReply(raw)
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.questions[0].no).toBe(1)
    expect(parsed.questions[0].question).toBe('改完之后的语气要偏向哪种？')
    expect(parsed.questions[0].options).toEqual([
      '更正式、克制',
      '更亲切、口语化',
      '保持原来的语气'
    ])
  })

  it('没有问题时不设 result', () => {
    expect(parseReply(raw).result).toBeNull()
  })

  it('不是兜底', () => {
    expect(parseReply(raw).fellBack).toBe(false)
  })
})

describe('选项少于 2 个的问题被丢弃', () => {
  it('只有一个选项的问题丢掉', () => {
    const raw = `【提问】
1. 这个问题只有一个选项？|唯一选项
2. 这个正常？|选项一|选项二`
    const parsed = parseReply(raw)
    expect(parsed.questions).toHaveLength(1)
    expect(parsed.questions[0].no).toBe(2)
  })

  it('没有选项的问题丢掉', () => {
    const raw = `【提问】
1. 这是个没有选项的问题？`
    const parsed = parseReply(raw)
    expect(parsed.questions).toHaveLength(0)
  })

  it('所有问题都被丢弃时走兜底', () => {
    const raw = `【提问】
1. 只有一个选项？|唯一`
    const parsed = parseReply(raw)
    expect(parsed.questions).toHaveLength(0)
    expect(parsed.fellBack).toBe(true)
  })

  it('选项里的空片段被忽略', () => {
    const raw = `【提问】
1. 问题？|选项一||选项二|`
    const parsed = parseReply(raw)
    expect(parsed.questions[0].options).toEqual(['选项一', '选项二'])
  })
})

describe('既没有【结果】也没有【提问】时兜底', () => {
  it('把去掉信息行之后的内容当作结果', () => {
    const raw = `【意图】修改文档
【模式】简单
请修改 @F1 的第二部分。`
    const parsed = parseReply(raw)

    expect(parsed.fellBack).toBe(true)
    expect(parsed.result).toBe('请修改 @F1 的第二部分。')
    // 信息行不该混进结果
    expect(parsed.result).not.toContain('【意图】')
  })

  it('完全没有任何内容时 result 为 null', () => {
    const parsed = parseReply('【意图】修改文档')
    expect(parsed.fellBack).toBe(true)
    expect(parsed.result).toBeNull()
  })

  it('空字符串也能安全处理', () => {
    const parsed = parseReply('')
    expect(parsed.fellBack).toBe(true)
    expect(parsed.result).toBeNull()
  })

  it('模型直接输出正文、完全没用协议时也能用', () => {
    const parsed = parseReply('请帮我修改 @F1 的第二部分。')
    expect(parsed.fellBack).toBe(true)
    expect(parsed.result).toBe('请帮我修改 @F1 的第二部分。')
  })
})

describe('前面有多余文字', () => {
  it('信息行之前的前言被忽略', () => {
    const raw = `好的，我来分析一下你的需求。
【意图】修改文档
【模式】简单
【结果】
请修改 @F1。`

    const parsed = parseReply(raw)
    expect(parsed.intent).toBe('修改文档')
    expect(parsed.mode).toBe('simple')
    expect(parsed.result).toBe('请修改 @F1。')
  })

  it('前言不会被混进结果', () => {
    const raw = `让我看看……
【结果】
真正的正文。`
    expect(parseReply(raw).result).toBe('真正的正文。')
  })
})

describe('结果里的代码块标记被去掉', () => {
  it('包裹全文的 ``` 去掉', () => {
    const raw = `【结果】
\`\`\`
请修改 @F1。
\`\`\``
    expect(parseReply(raw).result).toBe('请修改 @F1。')
  })

  it('带语言标记的也去掉', () => {
    const raw = `【结果】
\`\`\`markdown
## 任务
请修改 @F1。
\`\`\``
    expect(parseReply(raw).result).toBe('## 任务\n请修改 @F1。')
  })
})

describe('结果里保留 @ 引用', () => {
  it('引用原样保留', () => {
    const raw = `【结果】
请参考 @F1 和 @C1，再修改 @F2。`
    const result = parseReply(raw).result!
    expect(result).toContain('@F1')
    expect(result).toContain('@C1')
    expect(result).toContain('@F2')
  })
})

describe('信息行写在一行里', () => {
  it('【结果】后面的内容直接跟在标记后面', () => {
    const raw = `【意图】修改
【结果】请修改 @F1。`
    expect(parseReply(raw).result).toBe('请修改 @F1。')
  })

  it('【提问】后面的问题直接跟在标记后面', () => {
    const raw = `【提问】1. 语气？|正式|口语化`
    const parsed = parseReply(raw)
    expect(parsed.questions).toHaveLength(1)
  })
})

describe('流式阶段判断', () => {
  it('还没看到标记时是"分析中"', () => {
    expect(detectStreamPhase('【意图】修改')).toBe('analyzing')
    expect(detectStreamPhase('')).toBe('analyzing')
  })

  it('看到【结果】后进入结果阶段', () => {
    expect(detectStreamPhase('【意图】修改\n【结果】\n正文')).toBe('result')
  })

  it('看到【提问】后进入提问阶段', () => {
    expect(detectStreamPhase('【意图】修改\n【提问】\n1. 问题？|a|b')).toBe('questions')
  })

  it('标记只写了一半时不算', () => {
    expect(detectStreamPhase('【结')).toBe('analyzing')
    expect(detectStreamPhase('【结果')).toBe('analyzing')
  })
})

describe('流式取结果正文', () => {
  it('取出【结果】之后的内容', () => {
    expect(extractStreamResult('【意图】修改\n【结果】\n正文第一行')).toBe('正文第一行')
  })

  it('还没到【结果】时返回空', () => {
    expect(extractStreamResult('【意图】修改\n')).toBe('')
  })

  it('正文是流式增长的', () => {
    expect(extractStreamResult('【结果】\n请')).toBe('请')
    expect(extractStreamResult('【结果】\n请修改')).toBe('请修改')
    expect(extractStreamResult('【结果】\n请修改 @F1')).toBe('请修改 @F1')
  })
})
