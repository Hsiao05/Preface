import { findRefs } from './refs'
import type { CorpusResource, FileResource } from './types'

/**
 * 资料编号的分配。
 *
 * 【规则】优先复用"已经没人用"的编号。
 *
 * 一个编号可以被复用，必须同时满足：
 *   1. 当前资料列表里没有它（对应的资料已被删除）
 *   2. 原文里没有引用它
 *
 * 第二条是关键：只要原文里还留着 @F1，编号 F1 就不能给别人，
 * 否则那条引用会悄悄指向一份完全不同的资料。两条都满足时，
 * 复用编号不会造成任何误解，还能让编号保持紧凑。
 */

interface AllocationInput {
  files: FileResource[]
  corpora: CorpusResource[]
  intentText: string
  /** 兜底用的下一个编号（前面都被占用时才会用到） */
  nextFileNo: number
  nextCorpusNo: number
}

export interface Allocation {
  fileIds: string[]
  corpusIds: string[]
  /** 分配完之后，下一个可用的编号 */
  nextFileNo: number
  nextCorpusNo: number
}

/** 从 1 开始找第一个既没被占用、也没被引用的编号 */
function findFreeNumber(
  prefix: 'F' | 'C',
  usedIds: Set<string>,
  referencedIds: Set<string>,
  floor: number
): number {
  let n = 1
  for (;;) {
    const candidate = `${prefix}${n}`
    const taken = usedIds.has(candidate) || referencedIds.has(candidate)
    if (!taken) return n
    n++
    // 极端情况下（编号都被占）也不要死循环
    if (n > floor + 10000) return floor
  }
}

/**
 * 为接下来要加入的资料分配编号。
 *
 * @param count 要分配几个编号
 */
export function allocateIds(input: AllocationInput, kind: 'file' | 'corpus', count: number): Allocation {
  const usedFiles = new Set(input.files.map((f) => f.id))
  const usedCorpora = new Set(input.corpora.map((c) => c.id))

  // 原文里引用到的编号（去掉 @ 前缀）
  const referenced = new Set(findRefs(input.intentText).map((r) => r.slice(1)))

  const fileIds: string[] = []
  const corpusIds: string[] = []

  const wantFiles = kind === 'file' ? count : 0
  const wantCorpora = kind === 'corpus' ? count : 0

  // 分配文件编号：从 1 开始找空位，找不到就用 nextFileNo 往后加
  let fileCursor = 1
  for (let i = 0; i < wantFiles; i++) {
    fileCursor = findFreeNumber('F', usedFiles, referenced, input.nextFileNo)
    const id = `F${fileCursor}`
    fileIds.push(id)
    usedFiles.add(id)
    fileCursor++
  }

  let corpusCursor = 1
  for (let i = 0; i < wantCorpora; i++) {
    corpusCursor = findFreeNumber('C', usedCorpora, referenced, input.nextCorpusNo)
    const id = `C${corpusCursor}`
    corpusIds.push(id)
    usedCorpora.add(id)
    corpusCursor++
  }

  // 算新的"下一个编号"：现有的和引用的都算进去，取最大值的下一个
  const maxFile = Math.max(
    0,
    ...[...usedFiles].map((id) => Number(id.slice(1)) || 0),
    ...[...referenced].filter((id) => id.startsWith('F')).map((id) => Number(id.slice(1)) || 0)
  )
  const maxCorpus = Math.max(
    0,
    ...[...usedCorpora].map((id) => Number(id.slice(1)) || 0),
    ...[...referenced].filter((id) => id.startsWith('C')).map((id) => Number(id.slice(1)) || 0)
  )

  return {
    fileIds,
    corpusIds,
    nextFileNo: Math.max(maxFile + 1, input.nextFileNo),
    nextCorpusNo: Math.max(maxCorpus + 1, input.nextCorpusNo)
  }
}

/** 分配单个编号的便捷函数 */
export function allocateOneId(
  input: AllocationInput,
  kind: 'file' | 'corpus'
): { id: string; nextFileNo: number; nextCorpusNo: number } {
  const result = allocateIds(input, kind, 1)
  const id = kind === 'file' ? result.fileIds[0] : result.corpusIds[0]
  return { id, nextFileNo: result.nextFileNo, nextCorpusNo: result.nextCorpusNo }
}
