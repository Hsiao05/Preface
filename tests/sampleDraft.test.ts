import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, rm, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { sampleDraft } from './fixtures/sample-draft'
import { draftSchema } from '../src/main/draftSchema'
import { assemblePrompt } from '../src/shared/assemble'

/**
 * 示例草稿要能被 schema 接受，并且组装结果符合文档示例。
 * 这样"手动验证用的数据"和"程序真正接受的格式"就不会走偏。
 */

describe('示例草稿', () => {
  it('能通过草稿 schema 校验', () => {
    const draft = sampleDraft('C:\\测试')
    const parsed = draftSchema.safeParse(draft)
    if (!parsed.success) {
      console.log(parsed.error.issues)
    }
    expect(parsed.success).toBe(true)
  })

  it('组装出的文字包含全部三份资料', () => {
    const draft = sampleDraft('C:\\测试')
    const result = assemblePrompt({
      files: draft.files,
      corpora: draft.corpora,
      body: draft.intentText,
      target: draft.target
    })

    expect(result.text).toContain('id="F1"')
    expect(result.text).toContain('id="F2"')
    expect(result.text).toContain('id="C1"')
    expect(result.text).toContain('请根据 @C1 的反馈修改 @F1 的第二部分')
  })

  it('所有资料都被引用，没有警告', () => {
    const draft = sampleDraft('C:\\测试')
    const result = assemblePrompt({
      files: draft.files,
      corpora: draft.corpora,
      body: draft.intentText,
      target: draft.target
    })
    expect(result.warnings).toEqual([])
  })
})

describe('损坏的草稿文件', () => {
  it('JSON 语法错误时程序会备份并重来（这里验证"确实解析不了"）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'preface-bad-'))
    const path = join(dir, 'bad.json')
    // 反斜杠没有转义，是手写 JSON 时最常见的错误
    await writeFile(path, '{"path": "C:\\Users\\x"}', 'utf-8')

    const raw = await readFile(path, 'utf-8')
    expect(() => JSON.parse(raw)).toThrow()

    await rm(dir, { recursive: true, force: true })
  })
})
