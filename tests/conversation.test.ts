import { describe, expect, it } from 'vitest'
import {
  buildClarifyMessage,
  buildConversation,
  buildFirstRoundMessages,
  buildFollowUpMessages,
  buildModeSwitchMessage,
  type OptimizeSession
} from '../src/shared/conversation'
import { parseReply } from '../src/shared/parseReply'

/**
 * 对话结构。
 *
 * 文档第十一节要求：续写、补救、切换模式时，前三条消息与首轮完全相同。
 * 这组测试专门守住这一条 —— 它决定了能否命中服务商的前缀缓存。
 */

const FIRST_USER = `【模式】自动
【回复格式要求】不指定
【资料】
@F1 文件 年报.docx（可修改）
【原文】
请修改 @F1 的语气。`

const FIRST_REPLY = `【意图】修改 @F1 的语气
【模式】简单
【提问】
1. 语气要偏向哪种？|更正式、克制|更亲切、口语化`

function makeSession(over: Partial<OptimizeSession> = {}): OptimizeSession {
  return {
    firstUserMessage: FIRST_USER,
    firstReply: FIRST_REPLY,
    parsed: parseReply(FIRST_REPLY),
    answers: {},
    intentCorrection: null,
    followUps: [],
    ...over
  }
}

describe('对话结构', () => {
  it('前两条是首轮 user 和 assistant', () => {
    const conversation = buildConversation(makeSession())
    expect(conversation[0]).toEqual({ role: 'user', content: FIRST_USER })
    expect(conversation[1]).toEqual({ role: 'assistant', content: FIRST_REPLY })
  })

  it('追加的消息排在后面', () => {
    const session = makeSession({
      followUps: [{ role: 'user', content: '追加内容' }]
    })
    const conversation = buildConversation(session)
    expect(conversation).toHaveLength(3)
    expect(conversation[2]).toEqual({ role: 'user', content: '追加内容' })
  })

  it('首轮消息永远不变（前缀缓存的前提）', () => {
    const a = buildConversation(makeSession())
    const b = buildConversation(
      makeSession({
        answers: { '1': { state: 'chosen', value: '更正式、克制' } },
        followUps: [{ role: 'user', content: '澄清结果' }]
      })
    )
    // 前两条必须完全一致
    expect(a[0]).toEqual(b[0])
    expect(a[1]).toEqual(b[1])
  })
})

describe('澄清结果消息', () => {
  it('已选择的回答写成"用户选择"', () => {
    const session = makeSession({
      answers: { '1': { state: 'chosen', value: '更正式、克制' } }
    })
    const message = buildClarifyMessage(session)

    expect(message).toContain('【澄清结果】')
    expect(message).toContain('1. 用户选择：更正式、克制')
    expect(message).toContain('请直接输出【结果】，不要再提问。')
  })

  it('自己填写的回答也写成"用户选择"', () => {
    const session = makeSession({
      answers: { '1': { state: 'custom', value: '我希望更口语化一些' } }
    })
    expect(buildClarifyMessage(session)).toContain('1. 用户选择：我希望更口语化一些')
  })

  it('交给 AI 的判断写成"交给 AI 自行判断"', () => {
    const session = makeSession({
      answers: { '1': { state: 'delegated', value: '' } }
    })
    const message = buildClarifyMessage(session)
    expect(message).toContain('1. 交给 AI 自行判断')
    expect(message).not.toContain('用户选择')
  })

  it('未作答的问题不列出', () => {
    const reply = `【提问】
1. 问题一？|a|b
2. 问题二？|c|d`
    const session = makeSession({
      firstReply: reply,
      parsed: parseReply(reply),
      answers: { '2': { state: 'chosen', value: 'd' } }
    })

    const message = buildClarifyMessage(session)
    expect(message).not.toContain('1.')
    expect(message).toContain('2. 用户选择：d')
  })

  it('序号与首轮的问题对应（跳过的序号不重排）', () => {
    const reply = `【提问】
1. 问题一？|a|b
2. 问题二？|c|d
3. 问题三？|e|f`
    const session = makeSession({
      firstReply: reply,
      parsed: parseReply(reply),
      answers: {
        '1': { state: 'chosen', value: 'a' },
        '3': { state: 'delegated', value: '' }
      }
    })

    const message = buildClarifyMessage(session)
    expect(message).toContain('1. 用户选择：a')
    expect(message).toContain('3. 交给 AI 自行判断')
    expect(message).not.toContain('2.')
  })

  it('有意图更正时加上【意图更正】', () => {
    const session = makeSession({
      answers: { '1': { state: 'chosen', value: 'a' } },
      intentCorrection: '不是改语气，是要压缩篇幅'
    })
    const message = buildClarifyMessage(session)
    expect(message).toContain('【意图更正】')
    expect(message).toContain('不是改语气，是要压缩篇幅')
  })

  it('没有意图更正时省略那一行', () => {
    const session = makeSession({
      answers: { '1': { state: 'chosen', value: 'a' } }
    })
    expect(buildClarifyMessage(session)).not.toContain('【意图更正】')
  })

  it('全部未作答时也能生成（用户点了"跳过，直接优化"）', () => {
    const message = buildClarifyMessage(makeSession())
    expect(message).toContain('【澄清结果】')
    expect(message).toContain('请直接输出【结果】，不要再提问。')
  })
})

describe('切换模式的消息', () => {
  it('切到 Markdown', () => {
    expect(buildModeSwitchMessage('markdown')).toBe('请改用 Markdown 模式重新输出【结果】。')
  })

  it('切到简单', () => {
    expect(buildModeSwitchMessage('simple')).toBe('请改用 简单 模式重新输出【结果】。')
  })
})

describe('完整的消息列表', () => {
  const system = '你是「序」的提示词优化器。'

  it('首轮只有 system 和 user', () => {
    const messages = buildFirstRoundMessages(system, FIRST_USER)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toEqual({ role: 'system', content: system })
    expect(messages[1]).toEqual({ role: 'user', content: FIRST_USER })
  })

  it('续写时前三条与首轮完全相同', () => {
    const first = buildFirstRoundMessages(system, FIRST_USER)

    const session = makeSession({
      answers: { '1': { state: 'chosen', value: '更正式、克制' } }
    })
    const followUp = buildFollowUpMessages(
      system,
      session,
      { role: 'user', content: buildClarifyMessage(session) }
    )

    // system、user、assistant 三条与首轮一致
    expect(followUp[0]).toEqual(first[0]) // system
    expect(followUp[1]).toEqual(first[1]) // user（首轮）
    expect(followUp[2]).toEqual({ role: 'assistant', content: FIRST_REPLY }) // assistant（首轮输出）
    expect(followUp).toHaveLength(4) // 多一条澄清结果
  })

  it('补救时同样保持前三条不变', () => {
    const session = makeSession({
      answers: { '1': { state: 'chosen', value: 'a' } },
      followUps: [{ role: 'user', content: '第一轮澄清' }]
    })

    const remedy = buildFollowUpMessages(system, session, {
      role: 'user',
      content: '结果中缺少 @F2。请修正后重新输出【结果】。'
    })

    expect(remedy[0].role).toBe('system')
    expect(remedy[1].content).toBe(FIRST_USER)
    expect(remedy[2].content).toBe(FIRST_REPLY)
    // 首轮澄清 + 补救消息
    expect(remedy).toHaveLength(5)
  })

  it('切换模式时同样保持前三条不变', () => {
    const session = makeSession({
      answers: { '1': { state: 'chosen', value: 'a' } },
      followUps: [{ role: 'user', content: '第一轮澄清' }]
    })

    const switched = buildFollowUpMessages(system, session, {
      role: 'user',
      content: buildModeSwitchMessage('markdown')
    })

    expect(switched[1].content).toBe(FIRST_USER)
    expect(switched[2].content).toBe(FIRST_REPLY)
    expect(switched[3].content).toBe('第一轮澄清')
    expect(switched[4].content).toContain('改用 Markdown 模式')
  })

  it('消息的角色顺序合法（user 和 assistant 交替）', () => {
    const session = makeSession({
      answers: { '1': { state: 'chosen', value: 'a' } },
      followUps: [{ role: 'user', content: '澄清' }]
    })
    const messages = buildFollowUpMessages(system, session, {
      role: 'user',
      content: '补救'
    })

    // 除 system 外，角色应该是 user, assistant, user, user
    // （两次 user 连着是允许的，服务商会合并）
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[2].role).toBe('assistant')
    expect(messages[3].role).toBe('user')
  })
})
