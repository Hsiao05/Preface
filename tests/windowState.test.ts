import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// windowState.ts 依赖 electron 的 app/screen，无法在测试里直接引入。
// 这里测试它用到的 schema 和"可见性"判断逻辑，与实现保持同步。
const windowStateSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().min(200),
  height: z.number().min(200),
  maximized: z.boolean().optional()
})

/** 与 windowState.ts 中的 ensureVisible 相同的判断逻辑 */
function isVisible(
  state: { x?: number; y?: number; width: number; height: number },
  areas: Array<{ x: number; y: number; width: number; height: number }>
): boolean {
  if (state.x === undefined || state.y === undefined) return true
  return areas.some(
    (area) =>
      state.x! < area.x + area.width &&
      state.x! + state.width > area.x &&
      state.y! < area.y + area.height &&
      state.y! + state.height > area.y
  )
}

describe('窗口状态校验', () => {
  it('接受完整的窗口状态', () => {
    const result = windowStateSchema.safeParse({ x: 100, y: 200, width: 560, height: 720 })
    expect(result.success).toBe(true)
  })

  it('拒绝过小的尺寸', () => {
    expect(windowStateSchema.safeParse({ width: 100, height: 720 }).success).toBe(false)
    expect(windowStateSchema.safeParse({ width: 560, height: 100 }).success).toBe(false)
  })

  it('允许缺少坐标（用系统默认位置）', () => {
    expect(windowStateSchema.safeParse({ width: 560, height: 720 }).success).toBe(true)
  })

  it('拒绝坐标类型错误', () => {
    expect(windowStateSchema.safeParse({ x: '左边', width: 560, height: 720 }).success).toBe(false)
  })
})

describe('窗口可见性判断', () => {
  const primary = { x: 0, y: 0, width: 1920, height: 1040 }

  it('没有坐标时视为可见', () => {
    expect(isVisible({ width: 560, height: 720 }, [primary])).toBe(true)
  })

  it('窗口在主屏幕内时可见', () => {
    expect(isVisible({ x: 300, y: 200, width: 560, height: 720 }, [primary])).toBe(true)
  })

  it('窗口在屏幕外时不可见（外接显示器被拔掉的情况）', () => {
    expect(isVisible({ x: 3000, y: 200, width: 560, height: 720 }, [primary])).toBe(false)
  })

  it('窗口有一部分落在屏幕内时可见', () => {
    expect(isVisible({ x: 1800, y: 900, width: 560, height: 720 }, [primary])).toBe(true)
  })

  it('多显示器下任一屏幕可见即可', () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1040 }
    expect(isVisible({ x: 2200, y: 200, width: 560, height: 720 }, [primary, second])).toBe(true)
  })
})
