import { describe, expect, it } from 'vitest'
import { en, translate, zh } from '../src/shared/i18n'
import type { MessageKey } from '../src/shared/i18n'

/**
 * 中央词条表的结构约束。
 *
 * 英文漏翻、键名缺失或占位符对不上，都会在编译期或这里被拦住；
 * 不依赖逐个界面的截图。
 */

const CJK = /[㐀-鿿]/

/** 取出词条里的 {name} 占位符，排序后比较 */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

describe('中英词条一一对应', () => {
  it('两套词条的键完全相同', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('同一个键在两套语言里的占位符一致', () => {
    for (const key of Object.keys(zh) as MessageKey[]) {
      expect(placeholders(en[key]), `${key} 的占位符不一致`).toEqual(
        placeholders(zh[key])
      )
    }
  })

  it('中文词条都不为空，且没有空白键值', () => {
    for (const key of Object.keys(zh) as MessageKey[]) {
      expect(zh[key].trim(), `${key} 是空词条`).not.toBe('')
      expect(en[key].trim(), `${key} 的英文是空词条`).not.toBe('')
    }
  })
})

describe('英文词条里没有中文', () => {
  it('除了语言选择器里的「中文」，英文词条不出现中日韩字符', () => {
    for (const key of Object.keys(en) as MessageKey[]) {
      if (key === 'language.zh') continue
      expect(CJK.test(en[key]), `${key} 的英文里混入了中文：${en[key]}`).toBe(false)
    }
  })

  it('英文词条不使用中文全角标点', () => {
    const fullWidth = /[，。！？；：、“”‘’（）【】《》]/
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(fullWidth.test(en[key]), `${key} 用了中文全角标点：${en[key]}`).toBe(false)
    }
  })
})

describe('插值', () => {
  it('填入参数', () => {
    expect(translate('zh', 'editor.translateTo', { language: '法语' })).toBe(
      '翻译成法语'
    )
    expect(translate('en', 'editor.translateTo', { language: 'French' })).toBe(
      'Translate to French'
    )
  })

  it('缺少参数时保留占位符原文，方便发现漏传', () => {
    expect(translate('zh', 'editor.translateTo')).toBe('翻译成{language}')
  })

  it('参数值是 0 时不会被当成缺失', () => {
    expect(translate('en', 'status.tokens', { count: 0 })).toContain('0')
  })
})

describe('按语言选择词条', () => {
  it('中文用 zh，英文用 en', () => {
    expect(translate('zh', 'common.cancel')).toBe('取消')
    expect(translate('en', 'common.cancel')).toBe('Cancel')
  })
})
