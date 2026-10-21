import { describe, expect, it } from 'vitest'
import { findProtectedTokenIssues } from '../src/shared/protectedTokens'

describe('翻译/改写后的保护 token 检查', () => {
  it('命令和引用都保留时不报问题', () => {
    const source = '请 /review 一下 @F1 和 @C2'
    const result = 'Please /review @F1 and @C2'
    expect(findProtectedTokenIssues(source, result)).toEqual([])
  })

  it('缺少命令', () => {
    const issues = findProtectedTokenIssues('/review @F1', '@F1')
    expect(issues).toEqual([{ kind: 'missing-command', tokens: ['/review'] }])
  })

  it('多出命令', () => {
    const issues = findProtectedTokenIssues('@F1', '/review @F1')
    expect(issues).toEqual([{ kind: 'extra-command', tokens: ['/review'] }])
  })

  it('缺少引用', () => {
    const issues = findProtectedTokenIssues('/review @F1 @C2', '/review @F1')
    expect(issues).toEqual([{ kind: 'missing-ref', tokens: ['@C2'] }])
  })

  it('多出引用', () => {
    const issues = findProtectedTokenIssues('/review @F1', '/review @F1 @F9')
    expect(issues).toEqual([{ kind: 'extra-ref', tokens: ['@F9'] }])
  })

  it('同时缺少命令和引用时都列出来', () => {
    const issues = findProtectedTokenIssues('/review @F1 @F2', 'review')
    expect(issues).toEqual([
      { kind: 'missing-command', tokens: ['/review'] },
      { kind: 'missing-ref', tokens: ['@F1', '@F2'] }
    ])
  })

  it('普通斜杠路径和邮箱不算命令或引用', () => {
    expect(findProtectedTokenIssues('C:/work/a.txt', 'C:/work/a.txt')).toEqual([])
    expect(findProtectedTokenIssues('a@b.com', 'a@b.com')).toEqual([])
  })
})
