import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { statFile } from '../src/shared/fileMeta'

/**
 * 文件元信息读取。
 *
 * 注意：这里验证的是"只读元信息"这一条硬性要求 ——
 * 即便文件内容是任意二进制，statFile 也只会返回大小、时间等元信息。
 */

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'preface-test-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('statFile 读取元信息', () => {
  it('返回文件名、扩展名、大小和修改时间', async () => {
    const path = join(dir, '2024年报初稿.docx')
    await writeFile(path, '一些内容', 'utf-8')

    const info = await statFile(path)
    expect(info.exists).toBe(true)
    expect(info.name).toBe('2024年报初稿.docx')
    expect(info.ext).toBe('docx')
    expect(info.size).toBeGreaterThan(0)
    expect(info.mtime).toBeGreaterThan(0)
  })

  it('文件名里带空格也能正确读取', async () => {
    const path = join(dir, '带空格 的文件.txt')
    await writeFile(path, 'x', 'utf-8')

    const info = await statFile(path)
    expect(info.exists).toBe(true)
    expect(info.name).toBe('带空格 的文件.txt')
    expect(info.ext).toBe('txt')
  })

  it('扩展名统一转成小写', async () => {
    const path = join(dir, '大写扩展名.DOCX')
    await writeFile(path, 'x', 'utf-8')

    const info = await statFile(path)
    expect(info.ext).toBe('docx')
  })

  it('没有扩展名时不报错', async () => {
    const path = join(dir, '无扩展名文件')
    await writeFile(path, 'x', 'utf-8')

    const info = await statFile(path)
    expect(info.exists).toBe(true)
    expect(info.ext).toBe('')
  })

  it('文件不存在时返回 exists: false，不抛异常', async () => {
    const info = await statFile(join(dir, '不存在.docx'))
    expect(info.exists).toBe(false)
    expect(info.path).toContain('不存在.docx')
  })

  it('文件被改名后检测为不存在', async () => {
    const before = join(dir, '改名前.docx')
    const after = join(dir, '改名后.docx')
    await writeFile(before, 'x', 'utf-8')
    await rename(before, after)

    expect((await statFile(before)).exists).toBe(false)
    expect((await statFile(after)).exists).toBe(true)
  })

  it('指向目录时视为不存在（只接受文件）', async () => {
    const info = await statFile(dir)
    expect(info.exists).toBe(false)
  })

  it('内容任意二进制也不影响元信息读取', async () => {
    const path = join(dir, '二进制.bin')
    // 写入一段不是合法 UTF-8 的字节
    await writeFile(path, Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x02]))

    const info = await statFile(path)
    expect(info.exists).toBe(true)
    expect(info.size).toBe(5)
  })
})
