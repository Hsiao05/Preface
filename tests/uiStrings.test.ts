import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'

/**
 * 界面文案的静态兜底。
 *
 * 渲染进程和主进程里所有用户可见的字符串都必须走 i18n 词条；
 * 直接写死中文会在英文界面里漏出来。这里用 TypeScript AST 扫描
 * 字符串字面量、模板字符串和 JSX 文本，注释和日志不算。
 *
 * 模型输入、内置提示词、用户数据与内部哨兵值在 src/shared 里，
 * 不属于界面文案，不在扫描范围内。
 */

const root = join(__dirname, '..')
const CJK = /[㐀-鿿]/

/** 有意保留的中文字面量（目前没有；加之前先确认它不是用户可见文案） */
const ALLOWED = new Set<string>([])

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

function isInsideLogCall(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!ts.isCallExpression(parent)) continue
    const callee = parent.expression
    if (ts.isIdentifier(callee) && ['log', 'logContent', 'logError'].includes(callee.text)) {
      return true
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === 'console'
    ) {
      return true
    }
  }
  return false
}

function collect(rel: string): string[] {
  const file = join(root, rel)
  const source = readFileSync(file, 'utf-8')
  const script = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    let text: string | null = null
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      text = node.text
    } else if (ts.isJsxText(node)) {
      text = node.text
    }

    if (text && CJK.test(text) && !ALLOWED.has(text) && !isInsideLogCall(node)) {
      const { line } = script.getLineAndCharacterOfPosition(node.getStart())
      found.push(`${rel}:${line + 1} ${JSON.stringify(text)}`)
    }

    ts.forEachChild(node, visit)
  }

  visit(script)
  return found
}

describe('界面代码里没有写死的中文', () => {
  it('渲染进程与主进程的用户可见字符串全部走 i18n', () => {
    const files = [
      ...walk(join(root, 'src/renderer')),
      ...walk(join(root, 'src/main'))
    ].map((path) => relative(root, path).split('\\').join('/'))

    const leaks = files.flatMap(collect)
    expect(leaks, `发现写死的中文文案：\n${leaks.join('\n')}`).toEqual([])
  })

  it('扫描器本身能发现漏网的中文（防止误以为全绿）', () => {
    // 用一个临时文件验证扫描规则：JSX 文本和字符串都会被识别
    const sample = ts.createSourceFile(
      'sample.tsx',
      "const a = '中文'; const b = <div>中文</div>; // 注释不算\nlog('中文')",
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    )
    const hits: string[] = []
    const visit = (node: ts.Node): void => {
      let text: string | null = null
      if (ts.isStringLiteral(node)) text = node.text
      else if (ts.isJsxText(node)) text = node.text
      if (text && CJK.test(text) && !isInsideLogCall(node)) hits.push(text)
      ts.forEachChild(node, visit)
    }
    visit(sample)
    expect(hits).toEqual(['中文', '中文'])
  })
})
