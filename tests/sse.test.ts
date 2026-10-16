import { describe, expect, it } from 'vitest'
import {
  parseAnthropicLine,
  parseOpenAILine,
  parseOpenAIUsage,
  SseBuffer
} from '../src/shared/sse'

describe('parseOpenAILine', () => {
  it('取出 delta.content', () => {
    const line = JSON.stringify({
      choices: [{ delta: { content: '你好' } }]
    })
    expect(parseOpenAILine(line)).toEqual({ text: '你好', reasoning: false })
  })

  it('[DONE] 返回 null', () => {
    expect(parseOpenAILine('[DONE]')).toBeNull()
  })

  it('忽略 reasoning_content，但标记为思考内容', () => {
    const line = JSON.stringify({
      choices: [{ delta: { reasoning_content: '让我想想…' } }]
    })
    expect(parseOpenAILine(line)).toEqual({ text: '', reasoning: true })
  })

  it('同时有 reasoning_content 和 content 时，优先当思考处理', () => {
    const line = JSON.stringify({
      choices: [{ delta: { reasoning_content: '思考', content: '正文' } }]
    })
    // 思考内容不能被当成正文取出来
    expect(parseOpenAILine(line)?.text).toBe('')
  })

  it('空 delta 返回 null', () => {
    const line = JSON.stringify({ choices: [{ delta: {} }] })
    expect(parseOpenAILine(line)).toBeNull()
  })

  it('没有 choices 返回 null', () => {
    expect(parseOpenAILine(JSON.stringify({ usage: {} }))).toBeNull()
  })

  it('非法 JSON 返回 null 而不是抛异常', () => {
    expect(parseOpenAILine('{不是json')).toBeNull()
  })

  it('空字符串返回 null', () => {
    expect(parseOpenAILine('')).toBeNull()
  })
})

describe('parseOpenAIUsage', () => {
  it('读取 prompt_tokens 和 completion_tokens', () => {
    const usage = parseOpenAIUsage({
      usage: { prompt_tokens: 1280, completion_tokens: 540 }
    })
    expect(usage).toEqual({ input: 1280, output: 540, cached: 0 })
  })

  it('读取 cached_tokens', () => {
    const usage = parseOpenAIUsage({
      usage: {
        prompt_tokens: 1280,
        completion_tokens: 540,
        prompt_tokens_details: { cached_tokens: 1000 }
      }
    })
    expect(usage?.cached).toBe(1000)
  })

  it('没有 usage 时返回 null', () => {
    expect(parseOpenAIUsage({})).toBeNull()
  })

  it('用量都是 0 时返回 null', () => {
    expect(parseOpenAIUsage({ usage: { prompt_tokens: 0, completion_tokens: 0 } })).toBeNull()
  })
})

describe('parseAnthropicLine', () => {
  it('从 content_block_delta 取 text_delta', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: '你好' }
    })
    expect(parseAnthropicLine(line)?.delta).toEqual({ text: '你好', reasoning: false })
  })

  it('忽略 thinking_delta，标记为思考内容', () => {
    const line = JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'thinking_delta', thinking: '思考中' }
    })
    expect(parseAnthropicLine(line)?.delta).toEqual({ text: '', reasoning: true })
  })

  it('忽略 thinking 类型的 content_block_start', () => {
    const line = JSON.stringify({
      type: 'content_block_start',
      content_block: { type: 'thinking' }
    })
    expect(parseAnthropicLine(line)?.delta?.reasoning).toBe(true)
  })

  it('从 message_start 取 input_tokens 和 cache_read_input_tokens', () => {
    const line = JSON.stringify({
      type: 'message_start',
      message: {
        usage: { input_tokens: 1280, cache_read_input_tokens: 1000 }
      }
    })
    expect(parseAnthropicLine(line)?.usage).toEqual({ input: 1280, cached: 1000 })
  })

  it('从 message_delta 取 output_tokens', () => {
    const line = JSON.stringify({
      type: 'message_delta',
      usage: { output_tokens: 540 }
    })
    expect(parseAnthropicLine(line)?.usage).toEqual({ output: 540 })
  })

  it('不认识的事件类型返回 null', () => {
    expect(parseAnthropicLine(JSON.stringify({ type: 'ping' }))).toBeNull()
  })

  it('非法 JSON 返回 null', () => {
    expect(parseAnthropicLine('{坏')).toBeNull()
  })
})

describe('SseBuffer', () => {
  it('按行解析出 data 行', () => {
    const buffer = new SseBuffer()
    const lines = buffer.push('data: {"a":1}\ndata: {"b":2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('忽略非 data 行（例如 event: 和空行）', () => {
    const buffer = new SseBuffer()
    const lines = buffer.push('event: message\ndata: {"a":1}\n\n')
    expect(lines).toEqual(['{"a":1}'])
  })

  it('数据被切成两段时能正确拼接', () => {
    const buffer = new SseBuffer()
    const first = buffer.push('data: {"choices":[{"delta"')
    expect(first).toEqual([])

    const second = buffer.push(':{"content":"你好"}}]}\n')
    expect(second).toEqual(['{"choices":[{"delta":{"content":"你好"}}]}'])
  })

  it('flush 处理最后一行没有换行符的情况', () => {
    const buffer = new SseBuffer()
    buffer.push('data: {"a":1}')
    expect(buffer.flush()).toEqual(['{"a":1}'])
  })

  it('flush 之后缓冲区清空', () => {
    const buffer = new SseBuffer()
    buffer.push('data: {"a":1}')
    buffer.flush()
    expect(buffer.flush()).toEqual([])
  })

  it('空 data 行被忽略', () => {
    const buffer = new SseBuffer()
    expect(buffer.push('data: \n')).toEqual([])
  })
})
