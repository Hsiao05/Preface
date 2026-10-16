import { describe, expect, it } from 'vitest'
import {
  chatEndpoint,
  hostOf,
  modelsEndpoint,
  normalizeBaseUrl,
  suggestV1Retry
} from '../src/shared/normalize'

describe('normalizeBaseUrl', () => {
  it('去掉首尾空格', () => {
    expect(normalizeBaseUrl('  https://api.deepseek.com  ', 'openai')).toBe(
      'https://api.deepseek.com'
    )
  })

  it('去掉末尾的斜杠', () => {
    expect(normalizeBaseUrl('https://api.deepseek.com/', 'openai')).toBe(
      'https://api.deepseek.com'
    )
    expect(normalizeBaseUrl('https://api.deepseek.com///', 'openai')).toBe(
      'https://api.deepseek.com'
    )
  })

  it('OpenAI：去掉完整的 /chat/completions 路径', () => {
    expect(
      normalizeBaseUrl('https://api.deepseek.com/chat/completions', 'openai')
    ).toBe('https://api.deepseek.com')
    expect(
      normalizeBaseUrl('https://api.deepseek.com/v1/chat/completions', 'openai')
    ).toBe('https://api.deepseek.com/v1')
  })

  it('OpenAI：保留 /v1 前缀', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1', 'openai')).toBe(
      'https://api.openai.com/v1'
    )
  })

  it('Anthropic：去掉完整的 /v1/messages 路径', () => {
    expect(
      normalizeBaseUrl('https://api.anthropic.com/v1/messages', 'anthropic')
    ).toBe('https://api.anthropic.com')
  })

  it('Anthropic：base 已经以 /v1 结尾时保留', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/v1', 'anthropic')).toBe(
      'https://api.anthropic.com/v1'
    )
  })

  it('空字符串返回空', () => {
    expect(normalizeBaseUrl('', 'openai')).toBe('')
    expect(normalizeBaseUrl('   ', 'openai')).toBe('')
  })

  it('去掉空格后再去斜杠（顺序要正确）', () => {
    expect(normalizeBaseUrl('  https://x.com/  ', 'openai')).toBe('https://x.com')
  })
})

describe('chatEndpoint', () => {
  it('OpenAI：{base}/chat/completions', () => {
    expect(chatEndpoint('https://api.deepseek.com', 'openai')).toBe(
      'https://api.deepseek.com/chat/completions'
    )
  })

  it('OpenAI：带 /v1 的地址不再重复添加', () => {
    expect(chatEndpoint('https://api.openai.com/v1', 'openai')).toBe(
      'https://api.openai.com/v1/chat/completions'
    )
  })

  it('OpenAI：填了完整接口地址也能用', () => {
    expect(
      chatEndpoint('https://api.deepseek.com/chat/completions', 'openai')
    ).toBe('https://api.deepseek.com/chat/completions')
  })

  it('Anthropic：{base}/v1/messages', () => {
    expect(chatEndpoint('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('Anthropic：base 已含 /v1 时不重复添加', () => {
    expect(chatEndpoint('https://api.anthropic.com/v1', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
  })

  it('Anthropic：填了完整地址也能用', () => {
    expect(
      chatEndpoint('https://api.anthropic.com/v1/messages', 'anthropic')
    ).toBe('https://api.anthropic.com/v1/messages')
  })
})

describe('modelsEndpoint', () => {
  it('OpenAI：{base}/models', () => {
    expect(modelsEndpoint('https://api.deepseek.com', 'openai')).toBe(
      'https://api.deepseek.com/models'
    )
  })

  it('Anthropic：{base}/v1/models', () => {
    expect(modelsEndpoint('https://api.anthropic.com', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/models'
    )
  })

  it('Anthropic：已含 /v1 时不重复', () => {
    expect(modelsEndpoint('https://api.anthropic.com/v1', 'anthropic')).toBe(
      'https://api.anthropic.com/v1/models'
    )
  })
})

describe('suggestV1Retry（404 时补全 /v1）', () => {
  it('没有 /v1 时建议补上', () => {
    const result = suggestV1Retry('https://api.deepseek.com', 'openai')
    expect(result.changed).toBe(true)
    expect(result.url).toBe('https://api.deepseek.com/v1')
  })

  it('已经有 /v1 时不建议改动', () => {
    const result = suggestV1Retry('https://api.deepseek.com/v1', 'openai')
    expect(result.changed).toBe(false)
  })

  it('其他版本号（如 /v2）也不建议改动', () => {
    const result = suggestV1Retry('https://api.example.com/v2', 'openai')
    expect(result.changed).toBe(false)
  })

  it('Anthropic 格式不适用这个补救', () => {
    const result = suggestV1Retry('https://api.anthropic.com', 'anthropic')
    expect(result.changed).toBe(false)
  })

  it('补全后拼出的对话地址是正确的', () => {
    const { url } = suggestV1Retry('https://api.deepseek.com', 'openai')
    expect(chatEndpoint(url, 'openai')).toBe('https://api.deepseek.com/v1/chat/completions')
  })
})

describe('hostOf', () => {
  it('提取主机名用于隐私提示', () => {
    expect(hostOf('https://api.deepseek.com/v1')).toBe('api.deepseek.com')
  })

  it('不是合法地址时原样返回', () => {
    expect(hostOf('随便写的')).toBe('随便写的')
  })
})
