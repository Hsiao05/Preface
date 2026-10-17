import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildSystemPrompt, buildTidySystemPrompt } from '../src/shared/buildMessages'
import { BUILTIN_BLOCKS } from '../src/shared/prompts/blocks'
import { BUILTIN_TEMPLATES } from '../src/shared/prompts/templates'

/**
 * 音频文件转录的界面接线，以及 /命令 保留的接线。
 *
 * 纯逻辑（识别、比对、追加）在 commands.test.ts / appendText.test.ts /
 * audioFile.test.ts 里真跑。这里查的是"有没有真的接到界面上"：
 * 标签能不能点、按钮有没有接对函数、提示有没有地方渲染。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

// ---------- 资料栏 ----------

describe('资料栏的音频标签', () => {
  const bar = read('src/renderer/components/ResourceBar.tsx')

  it('用 isAudioFileExt 判断音频', () => {
    expect(bar).toContain('isAudioFileExt(file.ext)')
  })

  it('音频标签点击打开转录窗口', () => {
    expect(bar).toContain('onClick={audio ? () => setAudioFile(file) : undefined}')
  })

  it('键盘也能打开（Enter / 空格）', () => {
    expect(bar).toContain("event.key === 'Enter'")
    expect(bar).toContain('setAudioFile(file)')
  })

  it('悬停提示写明了可以点击转录', () => {
    expect(bar).toContain('点击转录，或拖到原文里引用')
  })

  it('文件删除按钮阻止冒泡（不然点叉会打开转录窗口）', () => {
    const i = bar.indexOf("requestDelete(file.id, file.name, 'file')")
    expect(i).toBeGreaterThan(-1)
    const before = bar.slice(Math.max(0, i - 300), i)
    expect(before).toContain('event.stopPropagation()')
  })

  it('非音频文件保持原来的纯拖动行为', () => {
    expect(bar).toContain('const audio = !missing && isAudioFileExt(file.ext)')
  })

  it('渲染转录窗口', () => {
    expect(bar).toContain('<AudioTranscribeDialog')
    expect(bar).toContain('file={audioFile}')
  })
})

// ---------- 转录窗口 ----------

describe('转录窗口', () => {
  const dialog = read('src/renderer/components/AudioTranscribeDialog.tsx')

  it('开始转录走主进程的 transcribeAudioFile', () => {
    expect(dialog).toContain('window.preface.transcribeAudioFile(file.path)')
    expect(dialog).not.toContain('fetch(')
  })

  it('未配置语音服务时不让开始', () => {
    expect(dialog).toContain('configured === true')
    expect(dialog).toContain('还没有配置语音识别')
  })

  it('文件超过 25 MB 时提示先压缩', () => {
    expect(dialog).toContain('MAX_AUDIO_FILE_BYTES')
    expect(dialog).toContain('请先压缩或截短')
  })

  it('转录中可以取消', () => {
    expect(dialog).toContain('取消转录')
    expect(dialog).toContain('window.preface.cancelTranscribe()')
  })

  it('关闭窗口时取消进行中的请求', () => {
    expect(dialog).toContain('cancelledRef.current = true')
    expect(dialog).toContain('void window.preface.cancelTranscribe()')
  })

  it('结果可以编辑后再用', () => {
    expect(dialog).toContain('<textarea')
    expect(dialog).toContain('setText(event.target.value)')
  })

  it('两个去向：作为语料、追加到原文', () => {
    expect(dialog).toContain('作为语料添加')
    expect(dialog).toContain('addCorpusToDraft(')
    expect(dialog).toContain('追加到原文')
    expect(dialog).toContain('appendWithSpacing(')
  })

  it('追加后切到原文标签', () => {
    expect(dialog).toContain("state.setActiveTab('source')")
  })

  it('空结果时提示，并禁用两个按钮', () => {
    expect(dialog).toContain('EMPTY_RESULT_MESSAGE')
    expect(dialog).toContain('phase === \'done\' && text')
  })

  it('语料标题默认取文件名（去掉扩展名）', () => {
    expect(dialog).toContain('titleFromName(file.name)')
    expect(dialog).toContain('lastIndexOf')
  })

  it('说明音频会发给语音服务、程序不保存副本', () => {
    expect(dialog).toContain('不保存音频副本')
  })
})

// ---------- 主进程与 preload ----------

describe('主进程与 preload', () => {
  const ipc = read('src/main/ipc.ts')
  const preload = read('src/preload/index.ts')
  const audioFile = read('src/main/speech/audioFile.ts')

  it('有 speech:transcribe-file 这个 IPC', () => {
    expect(ipc).toContain("ipcMain.handle('speech:transcribe-file'")
  })

  it('preload 暴露 transcribeAudioFile', () => {
    expect(preload).toContain('transcribeAudioFile: (path: string)')
    expect(preload).toContain("ipcRenderer.invoke('speech:transcribe-file', path)")
  })

  it('两个识别入口共用同一份配置读取', () => {
    expect(ipc).toContain('function currentSpeechContext()')
    // 1 次定义 + 两个入口各调用一次
    expect(ipc.match(/currentSpeechContext\(\)/g)?.length).toBe(3)
  })

  it('只有 audioFile.ts 读取文件内容', () => {
    expect(audioFile).toContain("from 'fs/promises'")
    expect(audioFile).toContain('readFile(path)')
  })

  it('读取集中在主进程，界面不碰文件系统', () => {
    const dialog = read('src/renderer/components/AudioTranscribeDialog.tsx')
    expect(dialog).not.toContain("from 'fs'")
    expect(dialog).not.toContain('readFile')
  })
})

// ---------- /命令 保留 ----------

describe('提示词里的命令保留规则', () => {
  it('改写规则有第 8 条', () => {
    expect(BUILTIN_BLOCKS.rules).toContain('8. 保留命令')
    expect(BUILTIN_BLOCKS.rules).toContain('/xxx-skill')
  })

  it('简单模式和 Markdown 模式都提到保留命令', () => {
    expect(BUILTIN_BLOCKS.simple).toContain('/命令原样保留')
    expect(BUILTIN_BLOCKS.markdown).toContain('/命令原样保留')
  })

  it('整理模板也保留命令', () => {
    expect(BUILTIN_TEMPLATES.tidy).toContain('/命令')
  })

  it('新规则会进到最终的系统提示词里', () => {
    const prompt = buildSystemPrompt({ styleId: 'clear-direct', maxQuestions: 3 })
    expect(prompt).toContain('8. 保留命令')
  })

  it('整理的系统提示词里也有', () => {
    expect(buildTidySystemPrompt()).toContain('/命令')
  })
})

describe('优化流程接上了命令校验', () => {
  const optimize = read('src/renderer/useOptimize.ts')
  const editor = read('src/renderer/components/EditorArea.tsx')
  const app = read('src/renderer/App.tsx')

  it('拿到结果后调用 buildCommandWarning', () => {
    expect(optimize).toContain('buildCommandWarning(sourceText, text)')
  })

  it('切换模式后也校验', () => {
    expect(optimize).toContain('commandWarning: buildCommandWarning(sourceText, cleaned)')
  })

  it('只提示，没有为此再调一次模型', () => {
    // 命令校验前后不应该出现 callModel 的补救调用
    const i = optimize.indexOf('buildCommandWarning(sourceText, text)')
    const around = optimize.slice(Math.max(0, i - 400), i + 400)
    expect(around).not.toContain('callModel(')
  })

  it('结果页把提示渲染出来', () => {
    expect(editor).toContain('commandWarning &&')
    expect(editor).toContain('refWarning &&')
  })

  it('App 把提示传给结果页', () => {
    expect(app).toContain('commandWarning={optimize.state.commandWarning}')
    expect(app).toContain('refWarning={optimize.state.refWarning}')
  })
})

describe('整理时丢了命令先问一句', () => {
  const hook = read('src/renderer/useLlmRun.ts')
  const app = read('src/renderer/App.tsx')

  it('覆盖原文前先算 missingCommands', () => {
    expect(hook).toContain('missingCommands(original, cleaned)')
  })

  it('有缺失时不直接覆盖，先挂起等确认', () => {
    const i = hook.indexOf('const missing = missingCommands(original, cleaned)')
    const body = hook.slice(i, i + 400)
    expect(body).toContain('setPendingCommand({ original, cleaned, missing })')
    expect(body).toContain('return')
  })

  it('确认后才替换，并保留撤销', () => {
    expect(hook).toContain('confirmReplace')
    expect(hook).toContain('setUndoText(pendingCommand.original)')
    expect(hook).toContain('store.setIntentText(pendingCommand.cleaned)')
  })

  it('取消后原文保持不变', () => {
    expect(hook).toContain('已保留原文')
  })

  it('界面上有确认框', () => {
    expect(app).toContain('整理结果里缺少命令')
    expect(app).toContain('tidy.confirmReplace')
    expect(app).toContain('tidy.cancelReplace')
  })
})
