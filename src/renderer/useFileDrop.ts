import { useEffect } from 'react'

/**
 * 窗口的任何位置都支持直接拖入文件。
 *
 * Electron 32 之后 File.path 被移除，真实路径要通过 preload 里的
 * webUtils.getPathForFile 拿。
 */
export function useFileDrop(onDrop: (paths: string[]) => void): void {
  useEffect(() => {
    /** 是程序内部的"引用标签"拖拽，不是从资源管理器拖文件进来 */
    const isInternalRefDrag = (event: DragEvent): boolean =>
      Boolean(event.dataTransfer?.types.includes('application/x-preface-ref'))

    const prevent = (event: DragEvent): void => {
      // 内部引用拖拽交给编辑器自己处理
      if (isInternalRefDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
    }

    const handleDrop = (event: DragEvent): void => {
      // 内部引用拖拽不当作"加入文件"
      if (isInternalRefDrag(event)) return

      event.preventDefault()
      event.stopPropagation()

      const files = event.dataTransfer?.files
      if (!files || files.length === 0) return

      const paths: string[] = []
      for (const file of Array.from(files)) {
        const path = window.preface.getPathForFile(file)
        if (path) paths.push(path)
      }

      if (paths.length > 0) onDrop(paths)
    }

    // 必须同时拦掉 dragover，否则浏览器会直接打开文件
    window.addEventListener('dragenter', prevent)
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragenter', prevent)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', handleDrop)
    }
  }, [onDrop])
}
