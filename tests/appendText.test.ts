import { describe, expect, it } from 'vitest'
import { appendWithSpacing } from '../src/shared/appendText'

/**
 * 转录结果追加到原文末尾。
 *
 * 按用户的选择：总是追加到末尾，不按光标位置插，中间空一行。
 */

describe('追加到空原文', () => {
  it('原文为空时直接就是这段文字', () => {
    expect(appendWithSpacing('', '转录的内容')).toBe('转录的内容')
  })

  it('原文只有空白时也当成空的', () => {
    expect(appendWithSpacing('  \n\n ', '转录的内容')).toBe('转录的内容')
  })
})

describe('追加时的空行', () => {
  it('原文没有换行结尾：补一个空行', () => {
    expect(appendWithSpacing('第一段', '第二段')).toBe('第一段\n\n第二段')
  })

  it('原文以一个换行结尾：再补一个', () => {
    expect(appendWithSpacing('第一段\n', '第二段')).toBe('第一段\n\n第二段')
  })

  it('原文已经以空行结尾：不补', () => {
    expect(appendWithSpacing('第一段\n\n', '第二段')).toBe('第一段\n\n第二段')
  })

  it('原文以多个空行结尾：也不补', () => {
    expect(appendWithSpacing('第一段\n\n\n', '第二段')).toBe('第一段\n\n\n第二段')
  })

  it('Windows 换行同样处理', () => {
    expect(appendWithSpacing('第一段\r\n', '第二段')).toBe('第一段\r\n\n第二段')
  })
})

describe('追加内容的清理', () => {
  it('去掉首尾空白', () => {
    expect(appendWithSpacing('原文', '  \n 转录的内容 \n ')).toBe('原文\n\n转录的内容')
  })

  it('追加内容是空的就原样返回', () => {
    expect(appendWithSpacing('原文', '   ')).toBe('原文')
    expect(appendWithSpacing('原文', '')).toBe('原文')
  })

  it('两段都是空的时候返回空', () => {
    expect(appendWithSpacing('', '')).toBe('')
  })
})
