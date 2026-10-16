import type { CorpusResource, FileResource, ReplyFormat } from '../../src/shared/types'

/**
 * 效果样例集（文档第六节）。
 *
 * 这 10 个固定输入用于"每次修改内置提示词后，用真实模型跑一遍，
 * 逐个检查结果，确认效果没有变差"。
 *
 * 【注意】这组用例需要真实模型才能验证，所以不在单元测试里自动跑。
 * 单元测试只保证它们的数据结构是合法的。
 * 手动验证方式：把 expect 里写的检查点当作人工检查清单。
 */

export interface Sample {
  no: number
  /** 用例特点 */
  trait: string
  /** 人工检查要点 */
  expect: string
  intentText: string
  files: FileResource[]
  corpora: CorpusResource[]
  mode: 'auto' | 'simple' | 'markdown'
  replyFormat: ReplyFormat
}

function file(id: string, name: string, note = ''): FileResource {
  return {
    id,
    name,
    path: `D:\\工作\\${name}`,
    ext: name.split('.').pop() ?? '',
    size: 100000,
    mtime: 1760000000000,
    note,
    permission: 'editable'
  }
}

function corpus(id: string, title: string, content: string): CorpusResource {
  return {
    id,
    title,
    titleSource: title ? 'user' : 'none',
    content,
    chars: content.length,
    createdAt: 1760000000000
  }
}

export const SAMPLES: Sample[] = [
  {
    no: 1,
    trait: '一段碎碎念式的单一修改要求，引用 1 个文件',
    expect: '自动选简单模式；没有 Markdown 符号；@F1 保留',
    intentText: '那个文档帮我看看 第二部分客户说太长了 语气也不太对 你改改 别改太多（@F1）',
    files: [file('F1', '2024年报初稿.docx', '待修改的原稿')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 2,
    trait: '一个清楚的简单问题',
    expect: '不提问，一次出结果',
    intentText: '请把 @F1 的第三段改写成更适合向客户展示的语气。',
    files: [file('F1', '项目说明.docx')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 3,
    trait: '含糊、缺关键信息的需求',
    expect: '提 1 到 3 个问题，问题有价值，不问废话',
    intentText: '帮我改改这个文档。',
    files: [file('F1', '产品介绍.docx')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 4,
    trait: '多步骤、多交付物的复杂任务',
    expect: '自动选 Markdown 模式；小节按需选用',
    intentText:
      '我需要根据 @C1 的反馈整理一份完整的产品改进方案，要包括问题清单、改进措施、优先级排序和落地时间表，最后还要一份给管理层看的一页纸摘要。',
    files: [],
    corpora: [corpus('C1', '用户反馈汇总', '用户反馈了很多问题……')],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 5,
    trait: '引用 3 个文件、2 个语料',
    expect: '所有引用保留，资料说明准确',
    intentText: '综合 @F1、@F2、@F3 和 @C1、@C2 的内容，写一份年度总结。',
    files: [
      file('F1', '季度报表.xlsx'),
      file('F2', '客户名单.docx'),
      file('F3', '竞品分析.pdf')
    ],
    corpora: [
      corpus('C1', '内部讨论纪要', '大家讨论了……'),
      corpus('C2', '用户访谈记录', '用户说……')
    ],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 6,
    trait: '含 1 个未命名语料',
    expect: '得到贴切的标题',
    intentText: '请根据 @C1 的内容总结三个要点。',
    files: [],
    corpora: [corpus('C1', '', '客户在电话里提到，我们的响应速度太慢，希望能有专人对接，另外报价方式也希望更灵活一些。')],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 7,
    trait: '英文输入',
    expect: '结果是英文',
    intentText: 'Please rewrite the second paragraph of @F1 to be more concise.',
    files: [file('F1', 'annual-report.docx')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 8,
    trait: '用户反复强调某一点',
    expect: '结果中这一点依然突出',
    intentText:
      '改一下 @F1。最重要的是不要改动任何数据，数据一定要原样保留，千万不能动数据，这点最关键。',
    files: [file('F1', '财务表.docx')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 9,
    trait: '第 3 号输入，部分问题交给 AI',
    expect: '结果中出现"由你判断，并先说明假设"',
    intentText: '帮我改改这个文档。',
    files: [file('F1', '产品介绍.docx')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  },
  {
    no: 10,
    trait: '含专业术语、人名、文件名',
    expect: '全部原样保留',
    intentText:
      '请修改 @F1，涉及《民法典》第 584 条的表述要准确。另外把张伟明的意见加进去，文件名叫"合同修订说明_v2.docx"。',
    files: [file('F1', '合同修订说明_v2.docx')],
    corpora: [],
    mode: 'auto',
    replyFormat: 'none'
  }
]
