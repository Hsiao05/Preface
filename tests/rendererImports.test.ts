import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * 界面进程不得导入带 node 依赖的模块。
 *
 * 【踩过的坑】0.2.0 的转录窗口为了用 formatSize，从 shared/fileMeta 导入。
 * 那个文件顶部有 `import { stat } from 'fs/promises'` —— 打包时会被
 * tree-shake 掉，所以安装包正常；但 Vite 开发模式会把它替换成
 * "externalized for browser compatibility" 的 Proxy，一取属性就抛异常，
 * 整个渲染模块图加载失败，窗口全白。
 *
 * 这条测试直接扫源码：界面文件不能导入 node 内置模块，也不能导入
 * 顶部带 node 导入的 shared 模块。formatSize 这类纯函数放在
 * src/renderer/format.ts。
 */

const root = join(__dirname, '..')

/** 递归收集 src/renderer 下的 .ts / .tsx */
function collect(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...collect(path))
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(path)
    }
  }
  return out
}

/** 取出一个文件里所有 import 的模块名 */
function importsOf(source: string): string[] {
  const out: string[] = []
  const re = /(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) out.push(match[1])
  return out
}

const NODE_BUILTINS = [
  'fs',
  'fs/promises',
  'path',
  'os',
  'crypto',
  'child_process',
  'electron',
  'node:fs',
  'node:path'
]

describe('界面进程的导入边界', () => {
  const files = collect(join(root, 'src/renderer'))

  it('能找到界面源码（防止收集逻辑失效后测试假通过）', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('不直接导入 node 内置模块', () => {
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      for (const spec of importsOf(source)) {
        expect(NODE_BUILTINS, `${file} 导入了 ${spec}`).not.toContain(spec)
      }
    }
  })

  it('不导入顶部带 node 依赖的 shared 模块', () => {
    // shared/fileMeta.ts 顶层 import fs/promises 和 path。
    // 打包能 tree-shake，开发模式会白屏。
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      const specs = importsOf(source)
      expect(specs, `${file} 导入了 shared/fileMeta`).not.toContain(
        '../../shared/fileMeta'
      )
      expect(specs, `${file} 导入了 shared/fileMeta`).not.toContain('../shared/fileMeta')
    }
  })

  it('shared 里只有 fileMeta 带 node 导入，以后新增的要在这里登记', () => {
    const sharedDir = join(root, 'src/shared')
    const withNode: string[] = []

    for (const name of readdirSync(sharedDir)) {
      const path = join(sharedDir, name)
      if (!statSync(path).isFile() || !/\.ts$/.test(name)) continue
      const source = readFileSync(path, 'utf-8')
      const specs = importsOf(source)
      if (specs.some((s) => NODE_BUILTINS.includes(s))) withNode.push(name)
    }

    // 只有 fileMeta 可以。新增的模块必须同时确认界面不会导入它。
    expect(withNode).toEqual(['fileMeta.ts'])
  })
})
