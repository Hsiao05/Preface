import { describe, expect, it, vi } from 'vitest'
import { createDraft } from '../src/shared/types'
import { BUILTIN_BLOCKS } from '../src/shared/prompts/blocks'

/**
 * 一键清空 与 语料标题。
 *
 * 清空的范围和保留范围是用户明确要求的，这里锁住。
 */

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useRef: (v: unknown) => ({ current: v }),
  useState: (v: unknown) => [v, () => {}],
  useEffect: () => {}
}))

const { cleanTitle } = await import('../src/renderer/useTitle')

describe('清空草稿：清掉什么', () => {
  /** 与 store.ts 的 clearDraft 相同逻辑 */
  function clearDraft(draft: ReturnType<typeof createDraft>): ReturnType<typeof createDraft> {
    const fresh = createDraft(draft.id)
    return {
      ...fresh,
      target: draft.target,
      mode: draft.mode,
      styleId: draft.styleId,
      replyFormat: draft.replyFormat
    }
  }

  function fullDraft(): ReturnType<typeof createDraft> {
    const draft = createDraft('d_test')
    draft.intentText = '请修改 @F1。'
    draft.files = [
      {
        id: 'F1',
        name: 'a.docx',
        path: 'C:\\a.docx',
        ext: 'docx',
        size: 1,
        mtime: 1,
        note: '',
        permission: 'editable'
      }
    ]
    draft.corpora = [
      {
        id: 'C1',
        title: '语料',
        titleSource: 'user',
        content: '内容',
        chars: 2,
        createdAt: 1
      }
    ]
    draft.nextFileNo = 2
    draft.nextCorpusNo = 2
    draft.result = { text: '优化结果', editedByUser: false, stale: false }
    draft.optimization = {
      messages: [{ role: 'user', content: '对话' }],
      intent: '意图',
      resolvedMode: 'simple',
      questions: [{ no: 1, question: '问题？', options: ['a', 'b'] }],
      answers: { '1': { state: 'chosen', value: 'a' } },
      intentCorrection: null,
      usage: { input: 10, output: 5, cached: 0, estimated: false }
    }
    draft.lastAction = 'optimize'
    return draft
  }

  it('清掉原文', () => {
    expect(clearDraft(fullDraft()).intentText).toBe('')
  })

  it('清掉文件和语料', () => {
    const cleared = clearDraft(fullDraft())
    expect(cleared.files).toEqual([])
    expect(cleared.corpora).toEqual([])
  })

  it('清掉优化结果', () => {
    expect(clearDraft(fullDraft()).result).toBeNull()
  })

  it('清掉澄清问答记录', () => {
    expect(clearDraft(fullDraft()).optimization).toBeNull()
  })

  it('编号计数也重置', () => {
    const cleared = clearDraft(fullDraft())
    expect(cleared.nextFileNo).toBe(1)
    expect(cleared.nextCorpusNo).toBe(1)
  })
})

describe('清空草稿：保留什么', () => {
  function draftWithChoices(): ReturnType<typeof createDraft> {
    const draft = createDraft('d_test')
    draft.target = 'web'
    draft.mode = 'markdown'
    draft.styleId = 'rigorous'
    draft.replyFormat = 'plain'
    draft.intentText = '有内容'
    return draft
  }

  /** 与 store.ts 的 clearDraft 相同逻辑 */
  function clearDraft(draft: ReturnType<typeof createDraft>): ReturnType<typeof createDraft> {
    const fresh = createDraft(draft.id)
    return {
      ...fresh,
      target: draft.target,
      mode: draft.mode,
      styleId: draft.styleId,
      replyFormat: draft.replyFormat
    }
  }

  it('保留目标', () => {
    expect(clearDraft(draftWithChoices()).target).toBe('web')
  })

  it('保留模式', () => {
    expect(clearDraft(draftWithChoices()).mode).toBe('markdown')
  })

  it('保留风格', () => {
    expect(clearDraft(draftWithChoices()).styleId).toBe('rigorous')
  })

  it('保留回复格式要求', () => {
    expect(clearDraft(draftWithChoices()).replyFormat).toBe('plain')
  })

  it('草稿 id 不变（还是同一份草稿）', () => {
    const draft = draftWithChoices()
    expect(clearDraft(draft).id).toBe(draft.id)
  })
})

describe('语料标题清理', () => {
  it('去掉首尾引号', () => {
    expect(cleanTitle('"客户反馈整理"')).toBe('客户反馈整理')
    expect(cleanTitle('“客户反馈整理”')).toBe('客户反馈整理')
    expect(cleanTitle('《客户反馈整理》')).toBe('客户反馈整理')
  })

  it('去掉结尾的标点', () => {
    expect(cleanTitle('客户反馈整理。')).toBe('客户反馈整理')
    expect(cleanTitle('客户反馈整理。')).not.toContain('。')
  })

  it('去掉首尾空白', () => {
    expect(cleanTitle('  客户反馈整理  ')).toBe('客户反馈整理')
  })

  it('超过 20 字时截断', () => {
    const long = '这是一个非常非常非常非常非常非常长的标题'
    expect(cleanTitle(long).length).toBeLessThanOrEqual(20)
  })

  it('正常标题原样保留', () => {
    expect(cleanTitle('客户口头反馈整理')).toBe('客户口头反馈整理')
  })

  it('空字符串返回空', () => {
    expect(cleanTitle('')).toBe('')
  })

  it('只有标点时不报错', () => {
    expect(cleanTitle('。。。')).toBe('')
  })
})

describe('语料标题的归属规则', () => {
  /** 与 useOptimize 的 applyTitles 相同判断 */
  function shouldApply(
    corpus: { title: string; titleSource: string },
    newTitle: string
  ): boolean {
    if (corpus.titleSource === 'user' && corpus.title.trim()) return false
    if (corpus.title.trim() === newTitle.trim()) return false
    return true
  }

  it('未命名语料会被写上标题', () => {
    expect(shouldApply({ title: '', titleSource: 'none' }, '客户反馈整理')).toBe(true)
  })

  it('用户自己填过标题的不覆盖', () => {
    expect(shouldApply({ title: '我的标题', titleSource: 'user' }, 'AI 的标题')).toBe(false)
  })

  it('标题相同时不做无谓更新', () => {
    expect(shouldApply({ title: '客户反馈整理', titleSource: 'ai' }, '客户反馈整理')).toBe(false)
  })

  it('AI 起的标题可以被新的 AI 标题更新', () => {
    expect(shouldApply({ title: '旧标题', titleSource: 'ai' }, '新标题')).toBe(true)
  })
})

describe('用词检查规则写进了内置提示词', () => {
  it('改写规则里有第 7 条用词检查', () => {
    expect(BUILTIN_BLOCKS.rules).toContain('用词检查')
  })

  it('说明了"明显错别字直接更正"', () => {
    expect(BUILTIN_BLOCKS.rules).toContain('直接更正')
  })

  it('说明了"专有名词不一致必须提问"', () => {
    expect(BUILTIN_BLOCKS.rules).toContain('必须提问')
  })

  it('给了语音识别错误的例子', () => {
    expect(BUILTIN_BLOCKS.rules).toContain('Claude Code')
    expect(BUILTIN_BLOCKS.rules).toContain('语雀')
  })

  it('判断标准是"会不会让 Agent 理解错"', () => {
    // 提示词里要说明为什么有些错要问、有些不用问
    expect(BUILTIN_BLOCKS.rules).toContain('明显')
  })
})
