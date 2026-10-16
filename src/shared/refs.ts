/**
 * @ 引用。格式只有一种：@ 后面紧跟 F 或 C 和数字。
 * 例如 @F1、@C12。
 */
export const REF_PATTERN = /@[FC]\d+/g

/** 找出文本里出现的全部引用编号，去重后按出现顺序返回 */
export function findRefs(text: string): string[] {
  const found = text.match(REF_PATTERN) ?? []
  return [...new Set(found)]
}

/** 统计某个编号在文本里出现了几次 */
export function countRef(text: string, id: string): number {
  // 用带边界的正则，避免 @F1 匹配到 @F12
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${escaped}(?!\\d)`, 'g')
  return (text.match(re) ?? []).length
}

/** 判断一个编号是否合法（F 或 C 加数字） */
export function isValidRef(id: string): boolean {
  return /^@[FC]\d+$/.test(id)
}
