import { describe, expect, it, vi } from 'vitest'
import { toOverrides } from '../src/renderer/usePromptOverrides'
import { buildSystemPrompt, buildTidySystemPrompt } from '../src/shared/buildMessages'
import { BUILTIN_BLOCKS } from '../src/shared/prompts/blocks'
import { estimateTokens } from '../src/shared/estimateTokens'
import type { StyleItemView } from '../src/preload/index'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\测试目录' }
}))

/**
 * 提示词与风格设置（第五阶段）。
 *
 * stylesStore 依赖 Electron 的 app.getPath，这里测纯逻辑部分：
 * 覆盖项的计算、以及它怎么影响最终组装出的提示词。
 */

function item(over: Partial<StyleItemView> & Pick<StyleItemView, 'id' | 'kind'>): StyleItemView {
  return {
    name: over.id,
    builtin: true,
    builtinVersion: 1,
    edited: false,
    text: '',
    ...over
  }
}

describe('覆盖项的计算', () => {
  it('没改过的块不覆盖（用代码里的内置版本）', () => {
    const overrides = toOverrides([item({ id: 'simple', kind: 'block', edited: false })])
    expect(overrides.blocks?.simple).toBeUndefined()
  })

  it('改过的块才覆盖', () => {
    const overrides = toOverrides([
      item({ id: 'simple', kind: 'block', edited: true, text: '我自己写的规则' })
    ])
    expect(overrides.blocks?.simple).toBe('我自己写的规则')
  })

  it('改过的模板才覆盖', () => {
    const overrides = toOverrides([
      item({ id: 'tidy', kind: 'template', edited: true, text: '我的整理模板' })
    ])
    expect(overrides.templates?.tidy).toBe('我的整理模板')
  })

  it('风格样本总是带上（有就传）', () => {
    const overrides = toOverrides([
      item({ id: 'my-style', kind: 'style', samples: ['样本一', '样本二'] })
    ])
    expect(overrides.styleSamples?.['my-style']).toEqual(['样本一', '样本二'])
  })

  it('没有样本的风格不传', () => {
    const overrides = toOverrides([item({ id: 'clear-direct', kind: 'style', samples: [] })])
    expect(overrides.styleSamples?.['clear-direct']).toBeUndefined()
  })

  it('附加要求总是带上', () => {
    const overrides = toOverrides([
      item({ id: 'extra', kind: 'extra', text: '我主要做法律文书。' })
    ])
    expect(overrides.extra).toBe('我主要做法律文书。')
  })
})

describe('改过的块会影响系统提示词', () => {
  it('改了简单模式写法后，提示词里是新的内容', () => {
    const overrides = toOverrides([
      item({ id: 'simple', kind: 'block', edited: true, text: '这是我自己写的简单模式规则。' })
    ])

    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3, overrides })

    expect(prompt).toContain('这是我自己写的简单模式规则。')
    expect(prompt).not.toContain(BUILTIN_BLOCKS.simple)
  })

  it('没改的块仍然是内置内容', () => {
    const overrides = toOverrides([item({ id: 'simple', kind: 'block', edited: false })])

    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3, overrides })
    expect(prompt).toContain(BUILTIN_BLOCKS.simple)
  })

  it('输出协议永远用内置版本，即使用户「改了」也不生效', () => {
    const overrides = toOverrides([
      item({ id: 'protocol', kind: 'block', edited: true, text: '被改过的协议' })
    ])

    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3, overrides })

    // buildSystemPrompt 里 protocol 硬编码用内置的
    expect(prompt).toContain(BUILTIN_BLOCKS.protocol)
    expect(prompt).not.toContain('被改过的协议')
  })
})

describe('风格样本', () => {
  it('有样本时按格式包装进提示词', () => {
    const overrides = toOverrides([
      item({ id: 'my-style', kind: 'style', samples: ['我的写法一', '我的写法二'] })
    ])

    const prompt = buildSystemPrompt({ styleId: 'my-style', maxQuestions: 3, overrides })

    expect(prompt).toContain('<样本1>\n我的写法一\n</样本1>')
    expect(prompt).toContain('<样本2>\n我的写法二\n</样本2>')
  })

  it('没有样本时提示词里没有样本块', () => {
    const overrides = toOverrides([item({ id: 'my-style', kind: 'style', samples: [] })])
    const prompt = buildSystemPrompt({ styleId: 'my-style', maxQuestions: 3, overrides })
    expect(prompt).not.toContain('风格样本：')
  })
})

describe('附加要求同时作用于优化和整理', () => {
  const extra = '称呼对方时一律用"您"。'
  const overrides = toOverrides([item({ id: 'extra', kind: 'extra', text: extra })])

  it('优化提示词里带上附加要求', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3, overrides })
    expect(prompt).toContain(`用户的附加要求：${extra}`)
  })

  it('整理碎碎念也带上附加要求', () => {
    const prompt = buildTidySystemPrompt({ overrides })
    expect(prompt).toContain(`用户的附加要求：${extra}`)
  })
})

describe('Token 估算', () => {
  it('组装后的提示词在预算内（约 1100 tokens 以内）', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    const tokens = estimateTokens(prompt)

    /*
     * 文档要求：不计风格样本，控制在约 1000 tokens 以内。
     * 0.2.0 加入"保留命令"规则后，原文已经接近 1000 的提示词多了约 80 tokens，
     * 所以这里的守卫线放宽到 1100 —— 仍然远低于界面 1500 的黄色预警线。
     */
    expect(tokens).toBeLessThan(1100)
  })

  it('超过 1500 时界面会提示（这里只验证阈值本身合理）', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    // 内置提示词不该接近警戒线
    expect(estimateTokens(prompt)).toBeLessThan(1500)
  })
})

describe('内置版本升级的规则', () => {
  /*
   * 直接测真实的 applyBuiltinUpgrades，不再在测试里复制一份逻辑 ——
   * 之前那份复制品把"改过的项也更新版本号"写成了正确行为，
   * 掩盖了 hasBuiltinUpdate 永远不显示"有更新"的缺陷。
   */
  type StyleItem = import('../src/main/stylesStore').StyleItem

  function item(over: Partial<StyleItem> & Pick<StyleItem, 'id'>): StyleItem {
    return {
      kind: 'block',
      name: over.id,
      builtin: true,
      builtinVersion: 1,
      edited: false,
      text: '旧内容',
      ...over
    }
  }

  async function upgrade(items: StyleItem[]): Promise<{
    items: StyleItem[]
    changed: boolean
    hasBuiltinUpdate: (i: StyleItem) => boolean
  }> {
    const { applyBuiltinUpgrades, hasBuiltinUpdate } = await import('../src/main/stylesStore')
    const result = applyBuiltinUpgrades(items)
    return { ...result, hasBuiltinUpdate }
  }

  it('用户没改过：直接替换为新版', async () => {
    const { items } = await upgrade([item({ id: 'rules', builtinVersion: 2 })])
    expect(items[0].text).toBe(BUILTIN_BLOCKS.rules)
    expect(items[0].builtinVersion).toBe(3)
    expect(items[0].edited).toBe(false)
  })

  it('用户改过：保留用户的文本和旧版本号，设置页持续提示有更新', async () => {
    const { items, changed, hasBuiltinUpdate } = await upgrade([
      item({ id: 'rules', builtinVersion: 2, edited: true, text: '我自己写的规则' })
    ])

    expect(items[0].text).toBe('我自己写的规则')
    expect(items[0].builtinVersion).toBe(2)
    // 没有内容变化，不必每次启动都写文件
    expect(changed).toBe(false)
    // 关键：要能显示"有更新"，否则用户永远收不到新的内置内容
    expect(hasBuiltinUpdate(items[0])).toBe(true)
  })

  it('版本号没变时什么都不做', async () => {
    const { items, changed } = await upgrade([
      item({ id: 'rules', builtinVersion: 3, text: '当前内容' })
    ])
    expect(items[0].text).toBe('当前内容')
    expect(changed).toBe(false)
  })

  it('用户新建的风格不受版本升级影响', async () => {
    const { items } = await upgrade([
      item({ id: 'my-own', builtin: false, builtinVersion: 0, text: '我的风格' })
    ])
    expect(items[0].text).toBe('我的风格')
    expect(items[0].builtinVersion).toBe(0)
  })

  it('这次升级覆盖了带命令保留规则的块', async () => {
    // 老用户数据里的版本号
    const { items } = await upgrade([
      item({ id: 'rules', builtinVersion: 2 }),
      item({ id: 'simple', builtinVersion: 1 }),
      item({ id: 'markdown', builtinVersion: 1 }),
      item({ id: 'tidy', kind: 'template', builtinVersion: 1 })
    ])

    expect(items[0].text).toContain('保留命令')
    expect(items[1].text).toContain('/命令')
    expect(items[2].text).toContain('/命令')
    expect(items[3].text).toContain('/命令')
  })
})
