import { describe, expect, it } from 'vitest'
import {
  buildCommandWarning,
  extraCommands,
  findSlashCommands,
  missingCommands
} from '../src/shared/commands'

/**
 * 斜杠命令的识别与校验。
 *
 * 用户原文里的 /review、/xxx-skill 这类命令必须原样保留。
 * 这里负责"事后抓"：识别命令、比对原文和结果、拼提示。
 */

describe('识别命令', () => {
  it('行首的命令', () => {
    expect(findSlashCommands('/review 这段代码')).toEqual(['/review'])
  })

  it('句中空格后面的命令', () => {
    expect(findSlashCommands('先跑一下 /review 再说')).toEqual(['/review'])
  })

  it('带连字符的命令', () => {
    expect(findSlashCommands('/xxx-skill 参数')).toEqual(['/xxx-skill'])
  })

  it('带冒号的插件命令', () => {
    expect(findSlashCommands('/plugin:skill')).toEqual(['/plugin:skill'])
  })

  it('括号、引号、反引号后面的命令', () => {
    expect(findSlashCommands('（/review）')).toEqual(['/review'])
    expect(findSlashCommands('"`/review`"')).toEqual(['/review'])
  })

  it('中文命令', () => {
    expect(findSlashCommands('/审查 这段代码')).toEqual(['/审查'])
  })

  it('命令后面的参数不影响识别', () => {
    expect(findSlashCommands('/review --deep file.ts')).toEqual(['/review'])
  })

  it('重复的命令只算一次', () => {
    expect(findSlashCommands('/review 一次\n/review 两次')).toEqual(['/review'])
  })

  it('多个不同的命令按出现顺序返回', () => {
    expect(findSlashCommands('/review 然后 /xxx-skill')).toEqual(['/review', '/xxx-skill'])
  })

  it('区分大小写', () => {
    expect(findSlashCommands('/Review')).toEqual(['/Review'])
  })
})

describe('不误判', () => {
  it('URL', () => {
    expect(findSlashCommands('见 https://example.com/a')).toEqual([])
  })

  it('日期', () => {
    expect(findSlashCommands('2024/10/16 的会议')).toEqual([])
  })

  it('Unix 路径', () => {
    expect(findSlashCommands('打开 /usr/bin 目录')).toEqual([])
  })

  it('HTML 标签', () => {
    expect(findSlashCommands('</div>')).toEqual([])
  })

  it('Markdown 链接', () => {
    expect(findSlashCommands('[文档](/guide/start)')).toEqual([])
  })

  it('文件名', () => {
    expect(findSlashCommands('/review.md 里写了什么')).toEqual([])
  })

  it('协议样写法', () => {
    expect(findSlashCommands('/review://abc')).toEqual([])
  })

  it('分数', () => {
    expect(findSlashCommands('比例是 1/2')).toEqual([])
  })

  it('斜杠后面不是字母', () => {
    expect(findSlashCommands('/ 单独一个斜杠')).toEqual([])
    expect(findSlashCommands('/123')).toEqual([])
    expect(findSlashCommands('/-')).toEqual([])
  })
})

describe('比对原文和结果', () => {
  it('结果完整保留时没有缺失', () => {
    expect(missingCommands('请 /review 这段代码', '请对这段代码执行 /review。')).toEqual([])
  })

  it('结果里命令被删掉时能发现', () => {
    expect(missingCommands('/review 这段代码', '请审查这段代码。')).toEqual(['/review'])
  })

  it('命令被改写（大小写变了）也算缺失', () => {
    expect(missingCommands('/Review 这段', '请 /review 这段')).toEqual(['/Review'])
  })

  it('多个命令只缺一部分', () => {
    expect(missingCommands('/review 和 /xxx-skill', '/review 一下')).toEqual(['/xxx-skill'])
  })

  it('结果里多出来的命令', () => {
    expect(extraCommands('/review', '/review 然后 /deploy')).toEqual(['/deploy'])
  })

  it('原文没有命令时不会误报多出', () => {
    expect(extraCommands('改一下这段话', '改一下这段话。')).toEqual([])
  })
})

describe('提示文字', () => {
  it('没问题时返回 null', () => {
    expect(buildCommandWarning('/review 这段', '/review 这段。')).toBeNull()
  })

  it('缺命令时说明是哪一个', () => {
    const warning = buildCommandWarning('/review 这段', '请审查这段。')
    expect(warning).toContain('/review')
    expect(warning).toContain('没有原样保留')
  })

  it('多个缺失命令都列出来', () => {
    const warning = buildCommandWarning('/review 和 /xxx-skill', '请审查。')
    expect(warning).toContain('/review')
    expect(warning).toContain('/xxx-skill')
  })

  it('多出命令时提醒确认', () => {
    const warning = buildCommandWarning('/review', '/review 然后 /deploy')
    expect(warning).toContain('/deploy')
    expect(warning).toContain('请确认是否需要')
  })

  it('既缺又多时两句话都在', () => {
    const warning = buildCommandWarning('/review', '/deploy')
    expect(warning).toContain('/review')
    expect(warning).toContain('/deploy')
  })
})
