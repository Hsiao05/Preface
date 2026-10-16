import { describe, expect, it } from 'vitest'
import { assemblePrompt } from '../src/shared/assemble'
import type { CorpusResource, FileResource } from '../src/shared/types'

function makeFile(over: Partial<FileResource> = {}): FileResource {
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

function makeCorpus(over: Partial<CorpusResource> = {}): CorpusResource {
  return {
    id: 'C1',
    title: '客户口头反馈整理',
    titleSource: 'user',
    content: '客户说第二部分太长了。',
    chars: 12,
    createdAt: 1760000000000,
    ...over
  }
}

const BASE = { body: '请帮我修改 @F1 的第二部分。', target: 'local' as const }

describe('无资料', () => {
  it('只输出正文，不出现资料说明和清单', () => {
    const result = assemblePrompt({ files: [], corpora: [], ...BASE })
    expect(result.text).toBe('请帮我修改 @F1 的第二部分。')
    expect(result.text).not.toContain('<资料说明>')
    expect(result.text).not.toContain('<资料清单>')
  })

  it('网页端没有资料时不返回上传清单', () => {
    const result = assemblePrompt({ files: [], corpora: [], body: '你好', target: 'web' })
    expect(result.uploads).toEqual([])
  })
})

describe('只有文件', () => {
  it('本地 Agent 写出绝对路径、权限和用途', () => {
    const result = assemblePrompt({ files: [makeFile()], corpora: [], ...BASE })
    expect(result.text).toContain(
      '<文件 id="F1" 名称="2024年报初稿.docx" 路径="D:\\工作\\年报\\2024年报初稿.docx" 权限="可修改" 用途="待修改的原稿"/>'
    )
    expect(result.text).not.toContain('<语料')
  })

  it('网页端只写文件名，并注明以附件形式上传', () => {
    const result = assemblePrompt({
      files: [makeFile()],
      corpora: [],
      body: '请帮我修改 @F1',
      target: 'web'
    })
    expect(result.text).toContain(
      '<文件 id="F1" 名称="2024年报初稿.docx" 提供方式="以附件形式上传" 权限="可修改" 用途="待修改的原稿"/>'
    )
    expect(result.text).not.toContain('路径=')
  })

  it('网页端返回需要上传的文件清单', () => {
    const file = makeFile()
    const result = assemblePrompt({
      files: [file],
      corpora: [],
      body: '请帮我修改 @F1',
      target: 'web'
    })
    expect(result.uploads).toHaveLength(1)
    expect(result.uploads[0].id).toBe('F1')
  })

  it('本地 Agent 不返回上传清单', () => {
    const result = assemblePrompt({ files: [makeFile()], corpora: [], ...BASE })
    expect(result.uploads).toEqual([])
  })

  it('没有用途备注时省略用途属性', () => {
    const result = assemblePrompt({
      files: [makeFile({ note: '' })],
      corpora: [],
      ...BASE
    })
    expect(result.text).not.toContain('用途=')
    expect(result.text).toContain('权限="可修改"')
  })

  it('只读权限写成"只读"', () => {
    const result = assemblePrompt({
      files: [makeFile({ permission: 'readonly' })],
      corpora: [],
      ...BASE
    })
    expect(result.text).toContain('权限="只读"')
  })
})

describe('只有语料', () => {
  it('语料清单只写标题和位置，全文放在后面的语料块里', () => {
    const result = assemblePrompt({ files: [], corpora: [makeCorpus()], ...BASE })
    expect(result.text).toContain(
      '<语料 id="C1" 标题="客户口头反馈整理" 位置="见下方"/>'
    )
    expect(result.text).toContain(
      '<语料 id="C1" 标题="客户口头反馈整理">\n客户说第二部分太长了。\n</语料>'
    )
  })

  it('未命名语料显示为"未命名语料"', () => {
    const result = assemblePrompt({
      files: [],
      corpora: [makeCorpus({ title: '', titleSource: 'none' })],
      ...BASE
    })
    expect(result.text).toContain('标题="未命名语料"')
  })

  it('多个语料按顺序排列', () => {
    const result = assemblePrompt({
      files: [],
      corpora: [
        makeCorpus({ id: 'C1', title: '第一个', content: '甲' }),
        makeCorpus({ id: 'C2', title: '第二个', content: '乙' })
      ],
      ...BASE
    })
    const first = result.text.indexOf('id="C1" 标题="第一个"')
    const second = result.text.indexOf('id="C2" 标题="第二个"')
    expect(first).toBeGreaterThan(-1)
    expect(second).toBeGreaterThan(first)
  })
})

describe('顺序：资料说明 → 资料清单 → 语料块 → 正文', () => {
  it('四部分按固定顺序出现', () => {
    const result = assemblePrompt({
      files: [makeFile()],
      corpora: [makeCorpus()],
      body: '请帮我修改 @F1，参考 @C1。',
      target: 'local'
    })
    const iIntro = result.text.indexOf('<资料说明>')
    const iManifest = result.text.indexOf('<资料清单>')
    const iCorpus = result.text.indexOf('<语料 id="C1"')
    const iBody = result.text.indexOf('请帮我修改 @F1，参考 @C1。')

    expect(iIntro).toBeGreaterThan(-1)
    expect(iManifest).toBeGreaterThan(iIntro)
    expect(iCorpus).toBeGreaterThan(iManifest)
    expect(iBody).toBeGreaterThan(iCorpus)
  })
})

describe('语料中含有结束标签', () => {
  it('给所有语料标签加同一个随机后缀', () => {
    const result = assemblePrompt({
      files: [],
      corpora: [
        makeCorpus({ id: 'C1', content: '这里故意写了 </语料> 想打断标签' }),
        makeCorpus({ id: 'C2', title: '第二份', content: '正常内容' })
      ],
      ...BASE
    })

    // 取出后缀
    const match = result.text.match(/<语料(-[a-z0-9]+) id="C1"/)
    expect(match).not.toBeNull()
    const suffix = match![1]

    // 两个语料用同一个后缀
    expect(result.text).toContain(`<语料${suffix} id="C2"`)
    expect(result.text).toContain(`</语料${suffix}>`)

    // 资料说明里同步改写
    expect(result.text).toContain(`本次语料标签带有后缀 ${suffix}`)

    // 语料正文原样保留，用户写的那串 </语料> 不能被改动
    expect(result.text).toContain('这里故意写了 </语料> 想打断标签')

    // 程序生成的标签一律带后缀：不带后缀的标签一个都不能有
    const generatedTags = result.text.match(/<\/?语料[^>]*>/g) ?? []
    const unsuffixed = generatedTags.filter(
      (tag) => !tag.startsWith(`<语料${suffix}`) && !tag.startsWith(`</语料${suffix}`)
    )
    // 唯一允许不带后缀的，是语料正文里用户自己写的那一个
    expect(unsuffixed).toEqual(['</语料>'])
  })

  it('语料里没有结束标签时不加后缀', () => {
    const result = assemblePrompt({ files: [], corpora: [makeCorpus()], ...BASE })
    expect(result.text).toContain('<语料 id="C1"')
    expect(result.text).not.toContain('本次语料标签带有后缀')
  })
})

describe('属性中含有引号', () => {
  it('文件名里的双引号转义为 &quot;', () => {
    const result = assemblePrompt({
      files: [makeFile({ name: '他说"这样改".docx' })],
      corpora: [],
      ...BASE
    })
    expect(result.text).toContain('名称="他说&quot;这样改&quot;.docx"')
    // 不能出现裸露的双引号破坏属性
    expect(result.text).not.toContain('名称="他说"这样改"')
  })

  it('用途备注里的双引号也转义', () => {
    const result = assemblePrompt({
      files: [makeFile({ note: '客户说"太长了"' })],
      corpora: [],
      ...BASE
    })
    expect(result.text).toContain('用途="客户说&quot;太长了&quot;"')
  })

  it('语料标题里的双引号转义', () => {
    const result = assemblePrompt({
      files: [],
      corpora: [makeCorpus({ title: '关于"改名"的讨论' })],
      ...BASE
    })
    expect(result.text).toContain('标题="关于&quot;改名&quot;的讨论"')
  })

  it('路径里的反斜杠保持原样', () => {
    const result = assemblePrompt({
      files: [makeFile({ path: 'C:\\我的 文档\\带空格 的目录\\文件.docx' })],
      corpora: [],
      ...BASE
    })
    expect(result.text).toContain('路径="C:\\我的 文档\\带空格 的目录\\文件.docx"')
  })
})

describe('有未被引用的资料', () => {
  it('未被引用的资料仍然放进清单，并给出提示', () => {
    const result = assemblePrompt({
      files: [makeFile({ id: 'F1' }), makeFile({ id: 'F2', name: '品牌规范.pdf' })],
      corpora: [],
      body: '请修改 @F1。',
      target: 'local'
    })
    expect(result.text).toContain('id="F2"')
    const warn = result.warnings.find((w) => w.kind === 'unreferenced')
    expect(warn).toBeDefined()
    expect(warn!.message).toContain('@F2')
  })

  it('排除的资料不放进清单，也不报警告', () => {
    const result = assemblePrompt({
      files: [makeFile({ id: 'F1' }), makeFile({ id: 'F2', name: '品牌规范.pdf' })],
      corpora: [],
      body: '请修改 @F1。',
      target: 'local',
      excluded: new Set(['F2'])
    })
    expect(result.text).not.toContain('id="F2"')
    expect(result.warnings.find((w) => w.kind === 'unreferenced')).toBeUndefined()
  })
})

describe('引用校验', () => {
  it('引用不存在的编号时给出警告', () => {
    const result = assemblePrompt({
      files: [makeFile()],
      corpora: [],
      body: '请参考 @F9 修改 @F1。',
      target: 'local'
    })
    const warn = result.warnings.find((w) => w.kind === 'missing-ref')
    expect(warn).toBeDefined()
    expect(warn!.message).toContain('@F9')
  })

  it('@F1 不会被 @F12 误判为已引用', () => {
    const result = assemblePrompt({
      files: [makeFile({ id: 'F1' }), makeFile({ id: 'F12', name: '另一个.docx' })],
      corpora: [],
      body: '请修改 @F12。',
      target: 'local'
    })
    // F1 没被引用，应该出现在"未被引用"的提示里
    const warn = result.warnings.find((w) => w.kind === 'unreferenced')
    expect(warn!.message).toContain('@F1')
    expect(warn!.message).not.toContain('@F12')
  })
})

describe('网页端重名检查', () => {
  it('两个文件同名时给出警告', () => {
    const result = assemblePrompt({
      files: [
        makeFile({ id: 'F1', name: '报告.docx', path: 'C:\\a\\报告.docx' }),
        makeFile({ id: 'F2', name: '报告.docx', path: 'C:\\b\\报告.docx' })
      ],
      corpora: [],
      body: '请参考 @F1 和 @F2。',
      target: 'web'
    })
    const warn = result.warnings.find((w) => w.kind === 'duplicate-name')
    expect(warn).toBeDefined()
    expect(warn!.message).toContain('报告.docx')
  })

  it('本地 Agent 不检查重名', () => {
    const result = assemblePrompt({
      files: [
        makeFile({ id: 'F1', name: '报告.docx', path: 'C:\\a\\报告.docx' }),
        makeFile({ id: 'F2', name: '报告.docx', path: 'C:\\b\\报告.docx' })
      ],
      corpora: [],
      body: '请参考 @F1 和 @F2。',
      target: 'local'
    })
    expect(result.warnings.find((w) => w.kind === 'duplicate-name')).toBeUndefined()
  })
})

describe('长度警告', () => {
  it('超过阈值时给出警告', () => {
    const result = assemblePrompt({
      files: [],
      corpora: [makeCorpus({ content: '甲'.repeat(100) })],
      body: '乙'.repeat(100),
      target: 'local',
      lengthWarnThreshold: 150
    })
    expect(result.warnings.find((w) => w.kind === 'too-long')).toBeDefined()
  })

  it('阈值设为 0 时不检查长度', () => {
    const result = assemblePrompt({
      files: [],
      corpora: [],
      body: '甲'.repeat(1000),
      target: 'local',
      lengthWarnThreshold: 0
    })
    expect(result.warnings.find((w) => w.kind === 'too-long')).toBeUndefined()
  })
})

describe('正文里的引用保持原样', () => {
  it('不把 @F1 改写成文件名', () => {
    const result = assemblePrompt({
      files: [makeFile()],
      corpora: [],
      body: '请修改 @F1。',
      target: 'local'
    })
    expect(result.text).toContain('请修改 @F1。')
  })
})
