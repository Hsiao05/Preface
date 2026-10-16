import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',

    /*
     * 每个测试文件用独立的模块环境。
     *
     * 【为什么必须开】
     * tests/fixtures/mockServer.ts 用一个模块级的常驻服务器（这样能避免
     * 端口反复分配导致的连接池问题）。但 vitest 默认会在同一个 worker 里
     * 复用模块，多个测试文件共享同一份模块状态，谁 reset() 一下就会
     * 把别人的服务器行为改掉 —— 表现是"单独跑通过、一起跑就失败"。
     * 打开隔离后每个文件拿到自己的模块实例。
     */
    isolate: true
  }
})
