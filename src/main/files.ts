import { dialog, shell, type BrowserWindow } from 'electron'
import type { FileResource } from '../shared/types'
import { allocateIds } from '../shared/allocateId'
import { statFile } from '../shared/fileMeta'
import { mainT } from './i18n'

/**
 * 文件模块里依赖 Electron 的部分。
 * 纯函数（statFile、toFileResources 等）放在 src/shared/fileMeta.ts，那边有单元测试。
 *
 * 【重要】本模块只处理文件的元信息和路径，绝对不读取文件内容。
 * 不出现 readFile、createReadStream 之类的调用。
 */

/** 打开文件选择框，返回选中的路径 */
export async function pickFiles(win: BrowserWindow | null): Promise<string[]> {
  const options: Electron.OpenDialogOptions = {
    title: mainT('files.pickTitle'),
    properties: ['openFile', 'multiSelections'],
    buttonLabel: mainT('files.pickButton')
  }

  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)

  if (result.canceled) return []
  return result.filePaths
}

/** 在资源管理器中显示并选中文件 */
export function showInFolder(path: string): void {
  shell.showItemInFolder(path)
}

/**
 * 把文件从窗口拖出（用于网页端）。
 * webContents.startDrag 必须提供图标，没有图标会报错。
 */
export function startDrag(win: BrowserWindow, paths: string[], iconPath: string): void {
  if (paths.length === 0) return
  win.webContents.startDrag({
    file: paths[0],
    files: paths,
    icon: iconPath
  })
}

export { statFile, statFiles, formatSize } from '../shared/fileMeta'

/**
 * 把一批路径转成 FileResource，自动跳过重复和不存在的文件。
 *
 * 编号规则见 src/shared/allocateId.ts：优先复用既没被占用、也没被引用的编号。
 */
export async function toFileResources(
  paths: string[],
  existing: FileResource[],
  intentText: string,
  nextFileNo: number
): Promise<{ added: FileResource[]; nextNo: number; skipped: string[] }> {
  const added: FileResource[] = []
  const skipped: string[] = []

  // 同一路径只保留一份（比较时忽略大小写，Windows 不区分）
  const known = new Set(existing.map((f) => f.path.toLowerCase()))
  const acceptedPaths: string[] = []

  for (const path of paths) {
    const key = path.toLowerCase()
    if (known.has(key)) {
      skipped.push(path)
      continue
    }

    const info = await statFile(path)
    if (!info.exists) {
      skipped.push(path)
      continue
    }

    known.add(key)
    acceptedPaths.push(path)
    added.push({
      // 编号先占位，下面统一分配
      id: '',
      name: info.name!,
      path,
      ext: info.ext!,
      size: info.size!,
      mtime: info.mtime!,
      note: '',
      permission: 'editable'
    })
  }

  // 一次性分配所有编号，避免中途状态不一致
  const allocation = allocateIds(
    {
      files: existing,
      corpora: [],
      intentText,
      nextFileNo,
      nextCorpusNo: 1
    },
    'file',
    added.length
  )

  added.forEach((file, index) => {
    file.id = allocation.fileIds[index]
  })

  return { added, nextNo: allocation.nextFileNo, skipped }
}
