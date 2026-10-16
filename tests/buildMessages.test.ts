import { describe, expect, it } from 'vitest'
import {
  buildOptimizeUserMessage,
  buildSystemPrompt,
  buildTidyMessages,
  buildTidySystemPrompt
} from '../src/shared/buildMessages'
import { BUILTIN_BLOCKS } from '../src/shared/prompts/blocks'
import { BUILTIN_TEMPLATES } from '../src/shared/prompts/templates'
import type { CorpusResource, FileResource } from '../src/shared/types'

function file(over: Partial<FileResource> = {}): FileResource {
  return {
    id: 'F1',
    name: '2024年报初稿.docx',
    path: 'D:\\工作\\年报\\2024年报初稿.docx',
    ext: 'docx',
    size: 1258291,
    mtime: 1760000000000,
    note: '待修改的原稿',
    permission: 'editable',
    ...over
  }
}

function corpus(over: Partial<CorpusResource> = {}): CorpusResource {
  return {
    id: 'C1',
    title: '客户口头反馈整理',
    titleSource: 'user',
    content: '客户说第二部分太长了。',
    chars: 3200,
    createdAt: 1760000000000,
    ...over
  }
}

describe('系统提示词的块顺序', () => {
  it('五个固定块按 1-5 的顺序出现', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })

    const iRole = prompt.indexOf('你是「序」的提示词优化器')
    const iRules = prompt.indexOf('改写规则：')
    const iSimple = prompt.indexOf('简单模式（适合单一修改')
    const iMarkdown = prompt.indexOf('Markdown 模式（适合多步骤')
    const iProtocol = prompt.indexOf('输出格式（必须严格遵守）')

    expect(iRole).toBeGreaterThan(-1)
    expect(iRules).toBeGreaterThan(iRole)
    expect(iSimple).toBeGreaterThan(iRules)
    expect(iMarkdown).toBeGreaterThan(iSimple)
    expect(iProtocol).toBeGreaterThan(iMarkdown)
  })

  it('块之间空一行拼接', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    expect(prompt).toContain('拿不准时选简单模式。\n\n改写规则：')
  })

  it('两种模式的写法都放进去（切换模式时不用换系统提示词）', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    expect(prompt).toContain('简单模式（适合单一修改')
    expect(prompt).toContain('Markdown 模式（适合多步骤')
  })

  it('最多提问数被填入块 2', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 5 })
    expect(prompt).toContain('最多 5 个')
    expect(prompt).not.toContain('{{最多提问数}}')
  })

  it('最多提问数为 0 时填 0', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 0 })
    expect(prompt).toContain('最多 0 个')
  })

  it('输出协议始终用内置版本，不采用用户的覆盖', () => {
    const prompt = buildSystemPrompt({
      styleId: 'clear-direct',
      maxQuestions: 3,
      overrides: { blocks: { protocol: '被改过的协议' } }
    })
    expect(prompt).toContain(BUILTIN_BLOCKS.protocol)
    expect(prompt).not.toContain('被改过的协议')
  })

  it('用户可以覆盖可编辑的块', () => {
    const prompt = buildSystemPrompt({
      styleId: 'clear-direct',
      maxQuestions: 3,
      overrides: { blocks: { simple: '我自己写的简单模式规则' } }
    })
    expect(prompt).toContain('我自己写的简单模式规则')
    expect(prompt).not.toContain('简单模式（适合单一修改')
  })
})

describe('表达风格（块 6）', () => {
  it('风格文字带"表达风格："前缀', () => {
    const prompt = buildSystemPrompt({ styleId: 'rigorous', maxQuestions: 3 })
    expect(prompt).toContain('表达风格：用词准确、无歧义。')
  })

  it('换风格时只有块 6 变化', () => {
    const a = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    const b = buildSystemPrompt({ styleId: 'concise', maxQuestions: 3 })

    // 去掉风格那一行后，其余完全相同
    const stripStyle = (s: string): string =>
      s
        .split('\n')
        .filter((line) => !line.startsWith('表达风格：'))
        .join('\n')

    expect(stripStyle(a)).toBe(stripStyle(b))
  })
})

describe('风格样本（块 7）', () => {
  it('没有样本时省略这一块', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    expect(prompt).not.toContain('风格样本：')
  })

  it('有样本时按格式包装', () => {
    const prompt = buildSystemPrompt({
      styleId: 'my-style',
      maxQuestions: 3,
      overrides: { styleSamples: { 'my-style': ['样本一的内容', '样本二的内容'] } }
    })
    expect(prompt).toContain('风格样本：')
    expect(prompt).toContain(
      '以下样本只用于模仿写法（句式、编号习惯、连接词、语气、详略），不要采用其中的具体内容。'
    )
    expect(prompt).toContain('<样本1>\n样本一的内容\n</样本1>')
    expect(prompt).toContain('<样本2>\n样本二的内容\n</样本2>')
  })

  it('样本排在输出协议之后', () => {
    const prompt = buildSystemPrompt({
      styleId: 'my-style',
      maxQuestions: 3,
      overrides: { styleSamples: { 'my-style': ['样本内容'] } }
    })
    expect(prompt.indexOf('输出格式（必须严格遵守）')).toBeLessThan(
      prompt.indexOf('风格样本：')
    )
  })
})

describe('我的附加要求（块 8）', () => {
  it('为空时省略', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3, overrides: { extra: '' } })
    expect(prompt).not.toContain('用户的附加要求：')
  })

  it('有内容时放在最后', () => {
    const prompt = buildSystemPrompt({
      styleId: 'clear-direct',
      maxQuestions: 3,
      overrides: { extra: '我主要做法律文书，涉及法条时写明条文编号。' }
    })
    expect(prompt).toContain('用户的附加要求：我主要做法律文书，涉及法条时写明条文编号。')
    // 在风格之后
    expect(prompt.indexOf('表达风格：')).toBeLessThan(prompt.indexOf('用户的附加要求：'))
  })
})

describe('系统提示词里不能有每次都变的内容（会破坏前缀缓存）', () => {
  it('同样的输入产生完全相同的提示词', () => {
    const a = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    const b = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    expect(a).toBe(b)
  })

  it('不含时间戳或随机数', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
    expect(prompt).not.toMatch(/timestamp/i)
  })
})

describe('优化的首轮 user 消息', () => {
  const base = {
    mode: 'auto' as const,
    replyFormat: 'none' as const,
    maxQuestions: 3,
    corpusInfo: 'title' as const
  }

  it('格式与文档第六节一致', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [file()],
      corpora: [corpus()],
      intentText: '请修改 @F1。'
    })

    expect(msg).toContain('【模式】自动')
    expect(msg).toContain('【回复格式要求】不指定')
    expect(msg).toContain('【资料】')
    expect(msg).toContain('@F1 文件 2024年报初稿.docx（可修改；待修改的原稿）')
    expect(msg).toContain('@C1 语料 客户口头反馈整理（约3200字）')
    expect(msg).toContain('【原文】\n请修改 @F1。')
  })

  it('没有资料时【资料】下面写"无"', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [],
      corpora: [],
      intentText: '你好'
    })
    expect(msg).toContain('【资料】\n无\n【原文】')
  })

  it('文件只写名称、权限和用途，不写路径、大小和类型', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [file()],
      corpora: [],
      intentText: '请修改 @F1。'
    })
    expect(msg).not.toContain('D:\\工作')
    expect(msg).not.toContain('1258291')
    // 不写文件类型（扩展名只出现在文件名里，不单独作为类型出现）
    expect(msg).not.toContain('类型')
    // 文档示例的原文就是 "文件名（可修改；用途）"
    expect(msg).toContain('@F1 文件 2024年报初稿.docx（可修改；待修改的原稿）')
  })

  it('没有用途备注时不写分号', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [file({ note: '' })],
      corpora: [],
      intentText: '请修改 @F1。'
    })
    expect(msg).toContain('@F1 文件 2024年报初稿.docx（可修改）')
  })

  it('只读权限写成"只读"', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [file({ permission: 'readonly' })],
      corpora: [],
      intentText: '请修改 @F1。'
    })
    expect(msg).toContain('（只读；待修改的原稿）')
  })

  it('未命名语料附带前 200 字摘录', () => {
    const long = '甲'.repeat(300)
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [],
      corpora: [corpus({ title: '', titleSource: 'none', content: long })],
      intentText: '请参考 @C1。'
    })
    expect(msg).toContain('@C1 语料 未命名（约3200字）摘录：（')
    // 只取前 200 字
    expect(msg).toContain('甲'.repeat(200))
    expect(msg).not.toContain('甲'.repeat(201))
  })

  it('已命名的语料不附带摘录', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      files: [],
      corpora: [corpus()],
      intentText: '请参考 @C1。'
    })
    expect(msg).not.toContain('摘录：')
  })

  it('设置成"摘录 300 字"时已命名的语料也带摘录', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      corpusInfo: 'excerpt300',
      files: [],
      corpora: [corpus({ content: '乙'.repeat(400) })],
      intentText: '请参考 @C1。'
    })
    expect(msg).toContain('摘录：（')
    expect(msg).toContain('乙'.repeat(300))
    expect(msg).not.toContain('乙'.repeat(301))
  })

  it('设置成"全文"时把语料全文放进去', () => {
    const content = '丙'.repeat(400)
    const msg = buildOptimizeUserMessage({
      ...base,
      corpusInfo: 'full',
      files: [],
      corpora: [corpus({ content })],
      intentText: '请参考 @C1。'
    })
    expect(msg).toContain(`全文：（${content}）`)
  })

  it('最多提问数为 0 时追加"不要提问"', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      maxQuestions: 0,
      files: [],
      corpora: [],
      intentText: '你好'
    })
    expect(msg).toContain('本次不要提问，直接输出【结果】。')
  })

  it('回复格式要求被写进去', () => {
    const msg = buildOptimizeUserMessage({
      ...base,
      replyFormat: 'markdown',
      files: [],
      corpora: [],
      intentText: '你好'
    })
    expect(msg).toContain('【回复格式要求】要求 Markdown')
  })

  it('模式被写进去', () => {
    expect(
      buildOptimizeUserMessage({ ...base, mode: 'simple', files: [], corpora: [], intentText: 'x' })
    ).toContain('【模式】简单')
    expect(
      buildOptimizeUserMessage({ ...base, mode: 'markdown', files: [], corpora: [], intentText: 'x' })
    ).toContain('【模式】Markdown')
  })

  it('不含时间戳或随机数（会破坏前缀缓存）', () => {
    const args = { ...base, files: [file()], corpora: [corpus()], intentText: '请修改 @F1。' }
    const a = buildOptimizeUserMessage(args)
    const b = buildOptimizeUserMessage(args)
    expect(a).toBe(b)
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/)
  })
})

describe('整理碎碎念的消息', () => {
  it('user 消息就是原文本身，不附带资料清单', () => {
    const messages = buildTidyMessages('就是我想做个小工具嘛')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1]).toEqual({ role: 'user', content: '就是我想做个小工具嘛' })
    expect(messages[1].content).not.toContain('【资料】')
  })

  it('system 用的是模板 D', () => {
    const messages = buildTidyMessages('内容')
    expect(messages[0].content).toContain(BUILTIN_TEMPLATES.tidy)
  })

  it('默认不附带风格样本', () => {
    const prompt = buildTidySystemPrompt({ styleId: 'my-style' })
    expect(prompt).not.toContain('<样本1>')
  })

  it('开启"整理也参考风格样本"后才追加样本', () => {
    const prompt = buildTidySystemPrompt({
      styleId: 'my-style',
      includeStyleSamples: true,
      overrides: { styleSamples: { 'my-style': ['我的写法'] } }
    })
    expect(prompt).toContain('<样本1>\n我的写法\n</样本1>')
  })

  it('"我的附加要求"在整理时同样生效', () => {
    const prompt = buildTidySystemPrompt({
      overrides: { extra: '称呼对方时一律用"您"。' }
    })
    expect(prompt).toContain('用户的附加要求：称呼对方时一律用"您"。')
  })
})
