import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * 深浅色模式。
 *
 * 主进程用 nativeTheme.themeSource 统一控制，渲染进程跟随
 * prefers-color-scheme 媒体查询。这里测纯逻辑部分。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

// ---------- resolveDark 的逻辑（与 useTheme.ts 保持一致）----------
type ThemeMode = 'system' | 'light' | 'dark'

function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  if (mode === 'dark') return true
  if (mode === 'light') return false
  return systemDark
}

describe('主题解析', () => {
  it('跟随设备：系统深色就是深色', () => {
    expect(resolveDark('system', true)).toBe(true)
  })

  it('跟随设备：系统浅色就是浅色', () => {
    expect(resolveDark('system', false)).toBe(false)
  })

  it('强制浅色：系统是深色也显示浅色', () => {
    expect(resolveDark('light', true)).toBe(false)
  })

  it('强制深色：系统是浅色也显示深色', () => {
    expect(resolveDark('dark', false)).toBe(true)
  })

  it('强制深色：系统也是深色时保持深色', () => {
    expect(resolveDark('dark', true)).toBe(true)
  })
})

describe('设置项', () => {
  it('主题设置有三个取值，默认跟随设备', () => {
    const source = read('src/main/settings.ts')
    expect(source).toContain("theme: z.enum(['system', 'light', 'dark']).default('system')")
  })
})

describe('主进程应用主题', () => {
  const source = read('src/main/window.ts')

  it('用 nativeTheme.themeSource 统一控制', () => {
    expect(source).toContain('nativeTheme.themeSource = theme')
  })

  it('窗口背景色跟着主题走（避免深色下启动闪白）', () => {
    expect(source).toContain('nativeTheme.shouldUseDarkColors')
    expect(source).toContain('setBackgroundColor')
  })

  it('启动时应用一次', () => {
    expect(read('src/main/index.ts')).toContain('applyTheme(settings.theme)')
  })

  it('设置变更时立刻应用', () => {
    expect(read('src/main/ipc.ts')).toContain('applyTheme(next.theme)')
  })
})

describe('渲染进程跟随主题', () => {
  const source = read('src/renderer/useTheme.ts')

  it('跟随设备时监听系统主题变化', () => {
    expect(source).toContain("addEventListener('change'")
    expect(source).toContain('prefers-color-scheme: dark')
  })

  it('在 html 上打标记，供全局 CSS 使用', () => {
    expect(source).toContain('documentElement.dataset.theme')
  })

  it('同时设置 colorScheme，让原生滚动条也跟着变', () => {
    expect(source).toContain('documentElement.style.colorScheme')
  })

  it('App 把主题传给 FluentProvider', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('useTheme(themeMode)')
    expect(app).toContain('<FluentProvider theme={theme}>')
  })
})

describe('深色模式下的自定义颜色都有对应的一套', () => {
  const css = read('src/renderer/index.css')

  it('@ 引用标签有深色版本', () => {
    expect(css).toContain("html[data-theme='dark'] .cm-ref-tag")
  })

  it('失效引用有深色版本', () => {
    expect(css).toContain("html[data-theme='dark'] .cm-broken-ref")
  })

  it('滚动条有深色版本（否则深色背景上看不见滑块）', () => {
    expect(css).toContain("html[data-theme='dark'] ::-webkit-scrollbar-thumb")
  })

  it('拖入遮罩有深色版本', () => {
    expect(css).toContain("html[data-theme='dark'] .drop-overlay")
  })

  it('拖入遮罩的颜色写在 CSS 里，不在组件里写死', () => {
    const app = read('src/renderer/App.tsx')
    // 组件里不该再出现硬编码的颜色值
    expect(app).not.toContain('rgba(15, 108, 189')
    expect(app).toContain('className="drop-overlay"')
  })
})

describe('设置界面有主题开关', () => {
  const source = read('src/renderer/components/settings/GeneralTab.tsx')

  it('三个选项都在', () => {
    expect(source).toContain("t('settings.general.themeSystem')")
    expect(source).toContain("t('settings.general.themeLight')")
    expect(source).toContain("t('settings.general.themeDark')")
  })

  it('用下拉框（用户反馈滑块用起来奇怪）', () => {
    expect(source).toContain('Dropdown')
    expect(source).toContain('onOptionSelect')
    // 不该再用三段式滑块
    expect(source).not.toContain('ToggleButton')
  })

  it('保存设置后广播事件，让主窗口立刻跟着变', () => {
    expect(source).toContain("dispatchEvent(new Event('preface:settings-changed'))")
    const app = read('src/renderer/App.tsx')
    expect(app).toContain("addEventListener('preface:settings-changed'")
  })

  it('主窗口读到设置后就换主题', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).toContain('setThemeMode(s.theme)')
  })
})

describe('显示 Token 用量开关接线了', () => {
  // 具体行为测在 statusText.test.ts；这里只确认两端接上了
  const app = read('src/renderer/App.tsx')
  const general = read('src/renderer/components/settings/GeneralTab.tsx')

  it('设置页改完会广播给主窗口', () => {
    expect(general).toContain("dispatchEvent(new Event('preface:settings-changed'))")
  })

  it('主窗口读了这个设置并传给状态条', () => {
    expect(app).toContain('s.showTokenUsage')
    expect(app).toContain('showTokenUsage')
  })
})

describe('界面里没有写死的浅色专属颜色', () => {
  it('拖拽遮罩不再内联颜色', () => {
    const app = read('src/renderer/App.tsx')
    expect(app).not.toContain("backgroundColor: 'rgba(")
  })

  it('组件统一用 tokens，不写死十六进制颜色', () => {
    const components = [
      'src/renderer/components/TopBar.tsx',
      'src/renderer/components/ResourceBar.tsx',
      'src/renderer/components/EditorArea.tsx',
      'src/renderer/components/BottomBar.tsx',
      'src/renderer/components/ClarifyPanel.tsx',
      'src/renderer/components/ClearButton.tsx'
    ]

    for (const file of components) {
      const source = read(file)
      // 允许 tokens 里没有对应值时用 rgba 做半透明，但不该出现 #xxxxxx
      const hexColors = source.match(/#[0-9a-fA-F]{6}\b/g) ?? []
      expect(hexColors, `${file} 里有写死的颜色: ${hexColors.join(', ')}`).toEqual([])
    }
  })
})
