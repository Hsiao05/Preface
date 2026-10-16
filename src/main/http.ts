import { net } from 'electron'

/**
 * 统一的 HTTP 实现。
 *
 * 【为什么用 Electron 的 net 模块】
 * 它会自动使用用户的系统代理设置，用户开着代理软件时也能正常访问。
 * Node 自带的 https 模块不走系统代理，会让用户遇到"说不清原因的连接失败"。
 *
 * 【为什么要能替换】
 * 单元测试跑在 Node 环境里，没有 net 模块，需要换成 Node 的 fetch。
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

let impl: FetchLike = (url, init) => net.fetch(url, init)

/** 发起请求 */
export function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  return impl(url, init)
}

/** 仅供测试使用：替换 HTTP 实现。传 null 恢复默认。 */
export function setFetchForTesting(fn: FetchLike | null): void {
  impl = fn ?? ((url, init) => net.fetch(url, init))
}
