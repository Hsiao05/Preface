import { describe, expect, it } from 'vitest'
import { SAMPLES } from './fixtures/samples'
import { buildOptimizeUserMessage } from '../src/shared/buildMessages'
import { assemblePrompt } from '../src/shared/assemble'

/**
 * 效果样例集的数据完整性。
 *
 * 这 11 个用例要靠真实模型人工检查效果（见 docs/SPEC.md 第六节）。
 * 单元测试负责保证：用例本身是合法的、能被组装成有效的输入，
 * 这样人工验证时不会因为数据问题白跑一遍。
 */

describe('样例集', () => {
  it('正好 11 个用例', () => {
    expect(SAMPLES).toHaveLength(11)
  })

  it('编号从 1 到 11 连续', () => {
    expect(SAMPLES.map((s) => s.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('每个用例都有输入特点说明和检查要点', () => {
    for (const sample of SAMPLES) {
      expect(sample.trait.length).toBeGreaterThan(0)
      expect(sample.expect.length).toBeGreaterThan(0)
      expect(sample.intentText.length).toBeGreaterThan(0)
    }
  })

  it('编号不重复', () => {
    const nos = SAMPLES.map((s) => s.no)
    expect(new Set(nos).size).toBe(nos.length)
  })
})

describe('样例能组装成有效的优化输入', () => {
  it('每个用例都能生成 user 消息', () => {
    for (const sample of SAMPLES) {
      const message = buildOptimizeUserMessage({
        mode: sample.mode,
        replyFormat: sample.replyFormat,
        files: sample.files,
        corpora: sample.corpora,
        intentText: sample.intentText,
        maxQuestions: 3,
        corpusInfo: 'title'
      })

      expect(message).toContain('【模式】')
      expect(message).toContain('【回复格式要求】')
      expect(message).toContain('【资料】')
      expect(message).toContain('【原文】')
      expect(message).toContain(sample.intentText)
    }
  })

  it('每个用例都能组装出最终提示词', () => {
    for (const sample of SAMPLES) {
      const result = assemblePrompt({
        files: sample.files,
        corpora: sample.corpora,
        body: sample.intentText,
        target: 'local'
      })
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.text).toContain(sample.intentText)
    }
  })
})

describe('每个用例检查它特有的东西', () => {
  it('用例 1：引用 1 个文件', () => {
    const sample = SAMPLES[0]
    expect(sample.files).toHaveLength(1)
    expect(sample.intentText).toContain('@F1')
  })

  it('用例 3 和 9 用同一个输入（第 9 号是在第 3 号基础上把问题交给 AI）', () => {
    expect(SAMPLES[2].intentText).toBe(SAMPLES[8].intentText)
  })

  it('用例 4：包含多个交付物', () => {
    const sample = SAMPLES[3]
    expect(sample.intentText).toContain('问题清单')
    expect(sample.intentText).toContain('改进措施')
    expect(sample.intentText).toContain('摘要')
  })

  it('用例 5：引用 3 个文件和 2 个语料', () => {
    const sample = SAMPLES[4]
    expect(sample.files).toHaveLength(3)
    expect(sample.corpora).toHaveLength(2)
  })

  it('用例 6：含一个未命名语料', () => {
    const sample = SAMPLES[5]
    expect(sample.corpora[0].title).toBe('')
    expect(sample.corpora[0].titleSource).toBe('none')
  })

  it('用例 7：输入是英文', () => {
    const sample = SAMPLES[6]
    expect(/^[\x00-\x7F]+$/.test(sample.intentText)).toBe(true)
  })

  it('用例 10：含专业术语、人名和带下划线的文件名', () => {
    const sample = SAMPLES[9]
    expect(sample.intentText).toContain('民法典')
    expect(sample.intentText).toContain('张伟明')
    expect(sample.files[0].name).toBe('合同修订说明_v2.docx')
  })

  it('用例 11：含 /命令 和参数', () => {
    const sample = SAMPLES[10]
    expect(sample.intentText).toContain('/review')
    expect(sample.intentText).toContain('/xxx-skill --strict')
  })
})
