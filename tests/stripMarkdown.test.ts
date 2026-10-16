import { describe, expect, it } from 'vitest'
import { stripMarkdown, stripPreamble } from '../src/shared/stripMarkdown'

describe('stripMarkdown：要处理的情况', () => {
  it('去掉行首的标题符号', () => {
    expect(stripMarkdown('# 标题')).toBe('标题')
    expect(stripMarkdown('## 二级标题')).toBe('二级标题')
    expect(stripMarkdown('###### 六级')).toBe('六级')
  })

  it('去掉行首的列表符号', () => {
    expect(stripMarkdown('- 第一项')).toBe('第一项')
    expect(stripMarkdown('* 第二项')).toBe('第二项')
    expect(stripMarkdown('+ 第三项')).toBe('第三项')
  })

  it('保留列表符号的缩进', () => {
    expect(stripMarkdown('  - 缩进的项')).toBe('  缩进的项')
  })

  it('去掉成对的加粗符号', () => {
    expect(stripMarkdown('这是**重点**内容')).toBe('这是重点内容')
    expect(stripMarkdown('**整行加粗**')).toBe('整行加粗')
  })

  it('丢掉表格分隔行', () => {
    const input = ['| 列1 | 列2 |', '| --- | --- |', '| a | b |'].join('\n')
    const result = stripMarkdown(input)
    expect(result).not.toContain('---')
    expect(result).toContain('| 列1 | 列2 |')
  })

  it('处理多行文本', () => {
    const input = ['# 标题', '', '- 要点一', '- 要点二', '', '**结尾**'].join('\n')
    const result = stripMarkdown(input)
    expect(result).toBe(['标题', '', '要点一', '要点二', '', '结尾'].join('\n'))
  })
})

describe('stripMarkdown：绝不能误删的情况', () => {
  it('保留 @ 引用', () => {
    expect(stripMarkdown('- 请修改 @F1')).toBe('请修改 @F1')
    expect(stripMarkdown('参考 @C12 的内容')).toBe('参考 @C12 的内容')
  })

  it('保留正文里的连字符（不是列表符号）', () => {
    expect(stripMarkdown('需要 3-5 天完成')).toBe('需要 3-5 天完成')
    expect(stripMarkdown('2024-2025 年度')).toBe('2024-2025 年度')
  })

  it('保留正文里的星号（不是列表符号）', () => {
    expect(stripMarkdown('计算 2*3 的结果')).toBe('计算 2*3 的结果')
    expect(stripMarkdown('用 * 表示通配')).toBe('用 * 表示通配')
  })

  it('保留有序列表编号（文档要求用 1. 2. 3.）', () => {
    expect(stripMarkdown('1. 第一点')).toBe('1. 第一点')
    expect(stripMarkdown('2. 第二点')).toBe('2. 第二点')
    expect(stripMarkdown('(1) 细分项')).toBe('(1) 细分项')
  })

  it('保留单个星号（不成对时不处理）', () => {
    expect(stripMarkdown('价格是 ** 元')).toBe('价格是 ** 元')
  })

  it('保留 # 后面没有空格的情况', () => {
    // 例如话题标签或代码里的 #
    expect(stripMarkdown('#标签')).toBe('#标签')
  })

  it('保留行内的连字符（不在行首）', () => {
    expect(stripMarkdown('这是一个 - 连接符')).toBe('这是一个 - 连接符')
  })

  it('保留中文正文原样', () => {
    const text = '请帮我修改 @F1 的第二部分，重点调整语气。'
    expect(stripMarkdown(text)).toBe(text)
  })

  it('保留文件名里的符号', () => {
    expect(stripMarkdown('参考 @F1（2024-年报_v2.docx）')).toBe(
      '参考 @F1（2024-年报_v2.docx）'
    )
  })
})

describe('stripPreamble：去掉开场白和代码块', () => {
  it('去掉包裹全文的代码块', () => {
    const input = '```\n请修改 @F1。\n```'
    expect(stripPreamble(input)).toBe('请修改 @F1。')
  })

  it('去掉带语言标记的代码块', () => {
    const input = '```markdown\n# 标题\n内容\n```'
    expect(stripPreamble(input)).toBe('# 标题\n内容')
  })

  it('去掉"以下是……"这类开场白', () => {
    const input = '以下是优化后的提示词：\n请修改 @F1。'
    expect(stripPreamble(input)).toBe('请修改 @F1。')
  })

  it('去掉开场白后面的空行', () => {
    const input = '以下是优化后的提示词：\n\n请修改 @F1。'
    expect(stripPreamble(input)).toBe('请修改 @F1。')
  })

  it('不误删正文里以"这是"开头的正常句子', () => {
    const input = '这是第一部分的内容，请你修改。\n第二段。'
    expect(stripPreamble(input)).toBe(input)
  })

  it('单行文本不做开场白处理', () => {
    const input = '以下是重点：'
    expect(stripPreamble(input)).toBe('以下是重点：')
  })

  it('没有开场白时原样返回', () => {
    const input = '请修改 @F1。\n谢谢。'
    expect(stripPreamble(input)).toBe(input)
  })

  it('去掉首尾空白', () => {
    expect(stripPreamble('  内容  ')).toBe('内容')
  })
})
