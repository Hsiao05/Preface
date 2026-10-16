import { describe, expect, it, vi } from 'vitest'
import { parseReply } from '../src/shared/parseReply'
import { buildClarifyMessage, buildFollowUpMessages } from '../src/shared/conversation'
import { validateRefs } from '../src/shared/validateRefs'
import { stripMarkdown, stripPreamble } from '../src/shared/stripMarkdown'
import type { CorpusResource, FileResource } from '../src/shared/types'

/**
 * 优化流程的整体行为。
 *
 * 这里不启动真实模型，而是把"模型可能给出的各种回答"喂进流程的各个环节，
 * 验证程序的处理是否正确。真实的网络调用由 llmClient.test.ts 覆盖。
 */

vi.mock('electron', () => ({
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  app: { getPath: () => 'C:\\测试目录', isPackaged: false }
}))

function file(id: string, name = `${id}.docx`): FileResource {
  return {
    id,
    name,
    path: `C:\\资料\\${name}`,
    ext: 'docx',
    size: 100,
    mtime: 1760000000000,
    note: '',
    permission: 'editable'
  }
}

function corpus(id: string): CorpusResource {
  return {
    id,
    title: '语料',
    titleSource: 'user',
    content: '内容',
    chars: 2,
    createdAt: 1760000000000
  }
}

/** 模拟"处理一次模型回答"的完整后处理 */
function processResult(
  rawReply: string,
  mode: 'simple' | 'markdown' | null,
  source: string,
  files: FileResource[],
  corpora: CorpusResource[]
): { text: string; refWarning: string | null } {
  const parsed = parseReply(rawReply)
  const body = parsed.result ?? ''

  // 简单模式兜底清理
  const cleaned = mode === 'simple' ? stripMarkdown(stripPreamble(body)) : stripPreamble(body)

  const check = validateRefs({ source, result: cleaned, files, corpora })

  return {
    text: cleaned,
    refWarning: check.ok ? null : '引用可能有误，请检查。'
  }
}

describe('需求清楚：一次调用出结果', () => {
  const reply = `【意图】修改 @F1 的语气
【模式】简单
【结果】
请帮我修改 @F1 的第二部分，把语气调整得更正式、克制。`

  it('结果被正确提取', () => {
    const result = processResult(reply, 'simple', '请修改 @F1 的语气。', [file('F1')], [])
    expect(result.text).toBe('请帮我修改 @F1 的第二部分，把语气调整得更正式、克制。')
  })

  it('引用校验通过', () => {
    const result = processResult(reply, 'simple', '请修改 @F1 的语气。', [file('F1')], [])
    expect(result.refWarning).toBeNull()
  })

  it('模式被识别为简单', () => {
    expect(parseReply(reply).mode).toBe('simple')
  })
})

describe('简单模式：Markdown 符号被清理', () => {
  it('模型不听话输出了 Markdown 时会被清掉', () => {
    const reply = `【意图】修改
【模式】简单
【结果】
# 任务
请修改 @F1：
- 精简篇幅
- 调整语气`

    const result = processResult(reply, 'simple', '修改 @F1。', [file('F1')], [])

    expect(result.text).not.toContain('# 任务')
    expect(result.text).not.toContain('- 精简')
    expect(result.text).toContain('精简篇幅')
    expect(result.text).toContain('@F1')
  })

  it('Markdown 模式不做清理', () => {
    const reply = `【意图】修改
【模式】Markdown
【结果】
## 任务目标
请修改 @F1。`

    const result = processResult(reply, 'markdown', '修改 @F1。', [file('F1')], [])
    expect(result.text).toContain('## 任务目标')
  })
})

describe('需要澄清：提问 → 回答 → 续写', () => {
  const firstReply = `【意图】修改 @F1
【模式】简单
【提问】
1. 语气要偏向哪种？|更正式、克制|更亲切、口语化
2. 篇幅要压缩多少？|压缩一半|只删重复的|不限`

  it('首轮解析出两个问题，没有结果', () => {
    const parsed = parseReply(firstReply)
    expect(parsed.questions).toHaveLength(2)
    expect(parsed.result).toBeNull()
  })

  it('澄清消息按序号对应问题', () => {
    const parsed = parseReply(firstReply)
    const message = buildClarifyMessage({
      firstUserMessage: '首轮消息',
      firstReply,
      parsed,
      answers: {
        '1': { state: 'chosen', value: '更正式、克制' },
        '2': { state: 'delegated', value: '' }
      },
      intentCorrection: null,
      followUps: []
    })

    expect(message).toContain('1. 用户选择：更正式、克制')
    expect(message).toContain('2. 交给 AI 自行判断')
  })

  it('续写的消息里前三条与首轮一致（前缀缓存）', () => {
    const parsed = parseReply(firstReply)
    const session = {
      firstUserMessage: '首轮消息',
      firstReply,
      parsed,
      answers: {},
      intentCorrection: null,
      followUps: []
    }

    const turn = { role: 'user' as const, content: '澄清结果' }
    const messages = buildFollowUpMessages('系统提示词', session, turn)

    expect(messages[0].content).toBe('系统提示词')
    expect(messages[1].content).toBe('首轮消息')
    expect(messages[2].content).toBe(firstReply)
  })

  it('四种回答状态在续写结果里表现不同', () => {
    const parsed = parseReply(firstReply)

    // 已选择 / 自己填写 → "用户选择"
    const chosen = buildClarifyMessage({
      firstUserMessage: 'x',
      firstReply,
      parsed,
      answers: { '1': { state: 'chosen', value: '更正式、克制' } },
      intentCorrection: null,
      followUps: []
    })
    expect(chosen).toContain('用户选择')

    // 交给 AI → "交给 AI 自行判断"
    const delegated = buildClarifyMessage({
      firstUserMessage: 'x',
      firstReply,
      parsed,
      answers: { '1': { state: 'delegated', value: '' } },
      intentCorrection: null,
      followUps: []
    })
    expect(delegated).toContain('交给 AI 自行判断')

    // 未作答 → 完全不出现
    const unanswered = buildClarifyMessage({
      firstUserMessage: 'x',
      firstReply,
      parsed,
      answers: {},
      intentCorrection: null,
      followUps: []
    })
    expect(unanswered).not.toContain('1.')
    expect(unanswered).not.toContain('2.')
  })
})

describe('引用校验与补救', () => {
  const files = [file('F1'), file('F2')]

  it('结果缺少引用时给出补救消息', () => {
    const check = validateRefs({
      source: '请修改 @F1 和 @F2。',
      result: '请修改 @F1。',
      files,
      corpora: []
    })
    expect(check.ok).toBe(false)
    expect(check.remedyMessage).toContain('@F2')
  })

  it('补救后的结果如果正确，警告消失', () => {
    const check = validateRefs({
      source: '请修改 @F1 和 @F2。',
      result: '请修改 @F1 和 @F2，注意保持一致性。',
      files,
      corpora: []
    })
    expect(check.ok).toBe(true)
  })

  it('补救后仍不正确时保留结果并提示', () => {
    const result = processResult(
      '【结果】\n请修改 @F1。',
      'simple',
      '请修改 @F1 和 @F2。',
      files,
      []
    )
    expect(result.text).toContain('@F1') // 结果保留
    expect(result.refWarning).toBe('引用可能有误，请检查。')
  })
})

describe('模型不按格式输出时', () => {
  it('把内容当结果，并标记兜底', () => {
    const parsed = parseReply('请帮我修改 @F1 的第二部分。')
    expect(parsed.fellBack).toBe(true)
    expect(parsed.result).toBe('请帮我修改 @F1 的第二部分。')
  })

  it('兜底的结果仍然可以正常处理和复制', () => {
    const result = processResult(
      '请帮我修改 @F1 的第二部分。',
      'simple',
      '修改 @F1。',
      [file('F1')],
      []
    )
    expect(result.text).toBe('请帮我修改 @F1 的第二部分。')
    expect(result.refWarning).toBeNull()
  })

  it('信息行混在正文里时也能提取出正文', () => {
    const raw = `【意图】修改文档
请帮我修改 @F1。`
    const parsed = parseReply(raw)
    expect(parsed.result).toBe('请帮我修改 @F1。')
    expect(parsed.result).not.toContain('【意图】')
  })
})

describe('未命名语料得到标题', () => {
  it('标题从【标题】行解析出来', () => {
    const reply = `【意图】整理
【模式】简单
【标题】C1=客户口头反馈整理
【结果】
请根据 @C1 整理。`

    const parsed = parseReply(reply)
    expect(parsed.titles).toEqual({ C1: '客户口头反馈整理' })
  })

  it('多个未命名语料各一行', () => {
    const reply = `【标题】C1=客户反馈整理
【标题】C2=历年访谈全文
【结果】
正文`
    expect(parseReply(reply).titles).toEqual({
      C1: '客户反馈整理',
      C2: '历年访谈全文'
    })
  })
})

describe('语言一致性', () => {
  it('英文输入的结果里不含中文信息行残留', () => {
    const reply = `【意图】rewrite the paragraph
【模式】simple
【结果】
Please rewrite the second paragraph of @F1 to be more concise.`

    const parsed = parseReply(reply)
    expect(parsed.result).toBe(
      'Please rewrite the second paragraph of @F1 to be more concise.'
    )
    expect(parsed.result).not.toContain('【')
  })
})
