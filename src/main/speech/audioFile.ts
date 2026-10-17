import { readFile, stat } from 'fs/promises'
import { basename, extname, isAbsolute } from 'path'
import {
  audioMimeForExt,
  isAudioFileExt,
  MAX_AUDIO_FILE_BYTES,
  type SpeechConfig
} from '../../shared/speech'
import { log } from '../logger'
import { SpeechError } from './errors'
import { transcribe } from './index'

/**
 * 音频文件转录。
 *
 * 【这是"绝不读取文件内容"规则的唯一例外】
 * 用户点击音频标签并确认开始转录时，才读取他选中的那一个文件。
 * 读到的字节只用于这一次请求：
 *   - 不写磁盘、不复制到应用数据目录
 *   - 不缓存
 *   - 不把内容写进日志（只记文件名和字节数）
 * 加入文件、拖入文件、优化、复制都不会走到这里。
 *
 * 不做转码：原文件直接交给服务商。服务商不认的格式会把它的报错显示给用户。
 */

/** 文件转录的超时时间。长音频比录音长得多。 */
export const AUDIO_FILE_TIMEOUT_MS = 180000

export interface AudioFileData {
  bytes: Uint8Array
  filename: string
  mime: string
}

/** 把文件名里可能破坏 multipart 头的字符去掉 */
function safeFilename(path: string): string {
  const name = basename(path)
  // 引号、换行、回车在 multipart 的 filename 里会破坏格式
  const cleaned = name.replace(/["\r\n]/g, '_').trim()
  return cleaned || 'audio'
}

/** 人类可读的大小，错误提示里用 */
function formatMb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

/**
 * 读取一个音频文件。
 *
 * 只接受：绝对路径、普通文件、白名单里的扩展名、非空、不超过 25 MB。
 * 任何一条不满足都抛出中文的 SpeechError，界面直接显示。
 */
export async function readAudioFile(path: string): Promise<AudioFileData> {
  if (!path || !isAbsolute(path)) {
    throw new SpeechError('文件路径不对', '请重新添加这个文件后再试。')
  }

  const ext = extname(path).replace(/^\./, '').toLowerCase()
  if (!isAudioFileExt(ext)) {
    throw new SpeechError('这个文件不是音频格式', '只支持 mp3、wav、m4a、flac、ogg 等常见音频格式。')
  }

  let size: number
  try {
    const info = await stat(path)
    if (!info.isFile()) {
      throw new SpeechError('这个路径不是文件', '请重新添加这个文件后再试。')
    }
    size = info.size
  } catch (error) {
    if (error instanceof SpeechError) throw error
    throw new SpeechError('文件不存在或无法读取', '它可能被移动或删除了，请重新添加。')
  }

  if (size === 0) {
    throw new SpeechError('这个文件是空的', '请换一个音频文件。')
  }

  if (size > MAX_AUDIO_FILE_BYTES) {
    throw new SpeechError(
      `文件太大（${formatMb(size)} MB）`,
      `语音服务通常限制 25 MB，请先压缩或截短到 ${formatMb(MAX_AUDIO_FILE_BYTES)} MB 以内。`
    )
  }

  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    throw new SpeechError('文件读取失败', '它可能正在被其他程序占用，请稍后再试。')
  }

  return {
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    filename: safeFilename(path),
    mime: audioMimeForExt(ext)
  }
}

/**
 * 转录一个音频文件。
 *
 * 先读文件，再交给现有的 transcribe()（请求由主进程发出）。
 * 返回清理过的文字；失败时抛 SpeechError。
 */
export async function transcribeAudioFile(input: {
  path: string
  config: SpeechConfig
  apiKey: string
}): Promise<string> {
  const file = await readAudioFile(input.path)

  log(`转录音频文件 ${file.filename}（${file.bytes.length} 字节）`)

  return transcribe({
    audio: file.bytes,
    config: input.config,
    apiKey: input.apiKey,
    mime: file.mime,
    filename: file.filename,
    timeoutMs: AUDIO_FILE_TIMEOUT_MS
  })
}
