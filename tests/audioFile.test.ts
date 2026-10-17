import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readFileSync } from 'fs'

/**
 * 音频文件转录。
 *
 * 这是"绝不读取文件内容"规则的唯一例外，所以除了功能本身，
 * 这里还要守住那条边界：读取只发生在 audioFile.ts。
 */

vi.mock('electron', () => ({
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  app: { getPath: () => 'C:\\测试目录', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { readAudioFile, transcribeAudioFile } = await import('../src/main/speech/audioFile')
const {
  AUDIO_EXTENSIONS,
  MAX_AUDIO_FILE_BYTES,
  audioMimeForExt,
  isAudioFileExt
} = await import('../src/shared/speech')
const { startMockServer } = await import('./fixtures/mockServer')
type MockServer = import('./fixtures/mockServer').MockServer
type SpeechConfig = import('../src/shared/speech').SpeechConfig

const root = join(__dirname, '..')
const dirs: string[] = []
let server: MockServer | null = null

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preface-audio-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function config(over: Partial<SpeechConfig> = {}): SpeechConfig {
  return {
    preset: 'siliconflow',
    baseUrl: '',
    model: 'test-model',
    apiType: 'transcriptions',
    language: 'auto',
    maxSeconds: 300,
    ...over
  }
}

// ---------- 扩展名与类型 ----------

describe('音频格式', () => {
  it('常见音频格式都认识', () => {
    for (const ext of ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac', 'opus', 'webm']) {
      expect(isAudioFileExt(ext)).toBe(true)
    }
  })

  it('带不带点都行，大小写不敏感', () => {
    expect(isAudioFileExt('.MP3')).toBe(true)
    expect(isAudioFileExt('Mp3')).toBe(true)
  })

  it('非音频格式不认', () => {
    for (const ext of ['txt', 'docx', 'pdf', 'png', 'zip', '']) {
      expect(isAudioFileExt(ext)).toBe(false)
    }
  })

  it('每种格式都有对应的 MIME', () => {
    for (const ext of AUDIO_EXTENSIONS) {
      expect(audioMimeForExt(ext)).toMatch(/^audio\//)
    }
  })

  it('mp3 是 audio/mpeg，m4a 是 audio/mp4', () => {
    expect(audioMimeForExt('mp3')).toBe('audio/mpeg')
    expect(audioMimeForExt('m4a')).toBe('audio/mp4')
    expect(audioMimeForExt('wav')).toBe('audio/wav')
  })

  it('大小上限是 25 MB', () => {
    expect(MAX_AUDIO_FILE_BYTES).toBe(25 * 1024 * 1024)
  })
})

// ---------- 读取文件 ----------

describe('读取音频文件', () => {
  it('读出内容、原文件名和 MIME', async () => {
    const dir = tempDir()
    const path = join(dir, '会议录音.mp3')
    writeFileSync(path, Buffer.from([1, 2, 3, 4, 5]))

    const file = await readAudioFile(path)

    expect(Array.from(file.bytes)).toEqual([1, 2, 3, 4, 5])
    expect(file.filename).toBe('会议录音.mp3')
    expect(file.mime).toBe('audio/mpeg')
  })

  it('文件名原样保留（带空格和中文）', async () => {
    const dir = tempDir()
    const path = join(dir, '2026 年 10 月 会议.wav')
    writeFileSync(path, Buffer.from([1]))

    const file = await readAudioFile(path)
    expect(file.filename).toBe('2026 年 10 月 会议.wav')
  })

  it('相对路径拒绝', async () => {
    await expect(readAudioFile('录音.mp3')).rejects.toMatchObject({
      message: '文件路径不对'
    })
  })

  it('不是音频格式拒绝', async () => {
    const dir = tempDir()
    const path = join(dir, '笔记.txt')
    writeFileSync(path, 'hello')

    await expect(readAudioFile(path)).rejects.toMatchObject({
      message: '这个文件不是音频格式'
    })
  })

  it('文件不存在时给出中文提示', async () => {
    const dir = tempDir()
    await expect(readAudioFile(join(dir, '没有这个.mp3'))).rejects.toMatchObject({
      message: '文件不存在或无法读取'
    })
  })

  it('空文件拒绝', async () => {
    const dir = tempDir()
    const path = join(dir, '空的.mp3')
    writeFileSync(path, '')

    await expect(readAudioFile(path)).rejects.toMatchObject({
      message: '这个文件是空的'
    })
  })

  it('超过 25 MB 拒绝，并说明当前大小', async () => {
    const dir = tempDir()
    const path = join(dir, '太大.wav')
    // 稀疏文件：只占元数据，不真的写 26 MB
    writeFileSync(path, Buffer.alloc(MAX_AUDIO_FILE_BYTES + 1))

    await expect(readAudioFile(path)).rejects.toMatchObject({
      message: expect.stringContaining('文件太大')
    })
  })

  it('目录路径拒绝', async () => {
    const dir = tempDir()
    await expect(readAudioFile(dir)).rejects.toMatchObject({
      message: expect.stringContaining('不是音频格式')
    })
  })
})

// ---------- 请求格式 ----------

describe('文件转录的请求', () => {
  it('发到 /audio/transcriptions，带原文件名和正确的 MIME', async () => {
    server = await startMockServer({ format: 'openai', reply: '转录出来的文字' })
    const dir = tempDir()
    const path = join(dir, 'clip.mp3')
    writeFileSync(path, Buffer.from([0x49, 0x44, 0x33]))

    const text = await transcribeAudioFile({
      path,
      config: config({ baseUrl: server.url }),
      apiKey: 'sk-test'
    })

    expect(text).toBe('转录出来的文字')
    expect(server.requests[0].url).toBe('/audio/transcriptions')

    // multipart 里应该出现原文件名和 audio/mpeg
    const body = (server.requests[0].body as string).toLowerCase()
    expect(body).toContain('filename="clip.mp3"')
    expect(body).toContain('content-type: audio/mpeg')
  })

  it('聊天接口用原格式的 data URI', async () => {
    server = await startMockServer({ format: 'openai', reply: '转录出来的文字' })
    const dir = tempDir()
    const path = join(dir, 'clip.m4a')
    writeFileSync(path, Buffer.from([1, 2, 3]))

    await transcribeAudioFile({
      path,
      config: config({ baseUrl: server.url, apiType: 'chat-audio' }),
      apiKey: 'k'
    })

    const body = server.requests[0].body as Record<string, unknown>
    const messages = body.messages as Array<Record<string, unknown>>
    const content = messages[0].content as Array<Record<string, unknown>>
    const audio = content[0].input_audio as Record<string, unknown>

    expect(server.requests[0].url).toBe('/chat/completions')
    expect(audio.data as string).toMatch(/^data:audio\/mp4;base64,/)
  })

  it('识别结果会清理标签', async () => {
    server = await startMockServer({ format: 'openai', reply: '<|zh|>你好<|NEUTRAL|>' })
    const dir = tempDir()
    const path = join(dir, 'clip.wav')
    writeFileSync(path, Buffer.from([1]))

    const text = await transcribeAudioFile({
      path,
      config: config({ baseUrl: server.url }),
      apiKey: 'k'
    })

    expect(text).toBe('你好')
  })

  it('服务商报错会变成中文提示', async () => {
    server = await startMockServer({ format: 'openai', status: 401 })
    const dir = tempDir()
    const path = join(dir, 'clip.wav')
    writeFileSync(path, Buffer.from([1]))

    await expect(
      transcribeAudioFile({
        path,
        config: config({ baseUrl: server.url }),
        apiKey: 'bad'
      })
    ).rejects.toMatchObject({ message: 'API Key 不正确或没有权限' })
  })
})

// ---------- 安全边界 ----------

describe('读取文件内容的边界', () => {
  it('资料模块仍然不读文件内容', () => {
    for (const rel of ['src/main/files.ts', 'src/shared/fileMeta.ts']) {
      const source = readFileSync(join(root, rel), 'utf-8')
      // 注释里提到这些名字没关系，这里查的是真正的调用
      expect(source).not.toMatch(/\breadFile(Sync)?\(/)
      expect(source).not.toMatch(/\bcreateReadStream\(/)
    }
  })

  it('音频读取只发生在 audioFile.ts', () => {
    const source = readFileSync(join(root, 'src/main/speech/audioFile.ts'), 'utf-8')
    expect(source).toContain('readFile')
  })

  it('读取的字节不写磁盘、不缓存', () => {
    const source = readFileSync(join(root, 'src/main/speech/audioFile.ts'), 'utf-8')
    expect(source).not.toContain('writeFile')
    expect(source).not.toContain('createWriteStream')
    expect(source).not.toContain('cache')
  })

  it('日志里只有文件名和字节数，没有内容', () => {
    const source = readFileSync(join(root, 'src/main/speech/audioFile.ts'), 'utf-8')
    expect(source).toContain('log(`转录音频文件 ${file.filename}（${file.bytes.length} 字节）`)')
  })
})
