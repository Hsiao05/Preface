import { describe, expect, it, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  cleanTranscript,
  SPEECH_PRESETS,
  API_TYPE_LABELS,
  DEFAULT_SPEECH_PRESET,
  TARGET_SAMPLE_RATE
} from '../src/shared/speech'
import { startMockServer, type MockServer } from './fixtures/mockServer'

/**
 * 语音输入（API 版）。
 *
 * 引擎和请求格式在 src/main/speech/ 下，这里测它们的纯逻辑部分
 * 和两种请求格式的实际行为。
 */

const root = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf-8')
}

// ---------- 结果清理 ----------

describe('识别结果清理', () => {
  it('去掉首尾空白', () => {
    expect(cleanTranscript('  你好  ')).toBe('你好')
  })

  it('去掉 SenseVoice 的 <|zh|> 这类标签', () => {
    expect(cleanTranscript('<|zh|>你好<|NEUTRAL|>')).toBe('你好')
  })

  it('去掉各种 <|...|> 标签', () => {
    expect(cleanTranscript('<|Speech|>测试内容<|en|>')).toBe('测试内容')
    expect(cleanTranscript('<|EMO_UNKNOWN|>你好')).toBe('你好')
  })

  it('去掉方括号形式的情感标记', () => {
    expect(cleanTranscript('[laughter] 你好')).toBe('你好')
    expect(cleanTranscript('你好 [applause]')).toBe('你好')
  })

  it('保留正文里的普通方括号内容', () => {
    // 只有已知的标记才删，普通方括号要留着
    expect(cleanTranscript('请参考[1]号文件')).toBe('请参考[1]号文件')
  })

  it('合并多余空格', () => {
    expect(cleanTranscript('你   好')).toBe('你 好')
  })

  it('合并过多空行', () => {
    expect(cleanTranscript('第一段\n\n\n\n第二段')).toBe('第一段\n\n第二段')
  })

  it('保留换行结构', () => {
    expect(cleanTranscript('第一行\n第二行')).toBe('第一行\n第二行')
  })

  it('全是标签时返回空', () => {
    expect(cleanTranscript('<|zh|><|NEUTRAL|>')).toBe('')
  })

  it('空字符串返回空', () => {
    expect(cleanTranscript('')).toBe('')
  })

  it('保留中英文混排', () => {
    expect(cleanTranscript('请打开 Claude Code')).toBe('请打开 Claude Code')
  })
})

// ---------- 预设 ----------

describe('服务商预设', () => {
  it('有五个预设', () => {
    expect(SPEECH_PRESETS).toHaveLength(5)
  })

  it('默认选中第一个（硅基流动，免费）', () => {
    expect(DEFAULT_SPEECH_PRESET).toBe('siliconflow')
    expect(SPEECH_PRESETS[0].id).toBe('siliconflow')
    expect(SPEECH_PRESETS[0].name).toContain('免费')
  })

  it('硅基流动用转写接口', () => {
    const preset = SPEECH_PRESETS.find((p) => p.id === 'siliconflow')!
    expect(preset.baseUrl).toBe('https://api.siliconflow.cn/v1')
    expect(preset.model).toBe('FunAudioLLM/SenseVoiceSmall')
    expect(preset.apiType).toBe('transcriptions')
  })

  it('阿里云百炼用聊天接口', () => {
    const preset = SPEECH_PRESETS.find((p) => p.id === 'dashscope')!
    expect(preset.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(preset.model).toBe('qwen3-asr-flash')
    expect(preset.apiType).toBe('chat-audio')
  })

  it('Groq 和 OpenAI 用转写接口', () => {
    expect(SPEECH_PRESETS.find((p) => p.id === 'groq')!.apiType).toBe('transcriptions')
    expect(SPEECH_PRESETS.find((p) => p.id === 'openai')!.apiType).toBe('transcriptions')
  })

  it('自定义预设的地址和模型是空的', () => {
    const preset = SPEECH_PRESETS.find((p) => p.id === 'custom')!
    expect(preset.baseUrl).toBe('')
    expect(preset.model).toBe('')
  })

  it('接口类型的显示名是中文', () => {
    expect(API_TYPE_LABELS.transcriptions).toBe('转写接口')
    expect(API_TYPE_LABELS['chat-audio']).toBe('聊天接口')
  })

  it('目标采样率是 16kHz', () => {
    expect(TARGET_SAMPLE_RATE).toBe(16000)
  })
})

// ---------- 请求格式 ----------

vi.mock('electron', () => ({
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  app: { getPath: () => 'C:\\测试目录', isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] }
}))

const { transcribeViaTranscriptions } = await import('../src/main/speech/transcriptions')
const { transcribeViaChatAudio } = await import('../src/main/speech/chatAudio')
type SpeechConfig = import('../src/shared/speech').SpeechConfig

let server: MockServer | null = null

afterEach(async () => {
  if (server) {
    await server.close()
    server = null
  }
})

function config(over: Partial<SpeechConfig> = {}): SpeechConfig {
  return {
    preset: 'siliconflow',
    baseUrl: '',
    model: 'test-model',
    apiType: 'transcriptions',
    language: 'auto',
    maxSeconds: 300,
    ...over
  }
}

/** 造一小段假的 WAV 数据 */
function fakeWav(): Uint8Array {
  // 44 字节头 + 一点数据
  return new Uint8Array(100)
}

describe('转写接口的请求格式', () => {
  it('发到 {base}/audio/transcriptions', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaTranscriptions(fakeWav(), {
      config: config({ baseUrl: server.url }),
      apiKey: 'sk-test'
    })

    expect(server.requests[0].url).toBe('/audio/transcriptions')
  })

  it('用 Bearer 认证', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaTranscriptions(fakeWav(), {
      config: config({ baseUrl: server.url }),
      apiKey: 'sk-speech'
    })

    expect(server.requests[0].headers['authorization']).toBe('Bearer sk-speech')
  })

  it('是 multipart/form-data（带 boundary）', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaTranscriptions(fakeWav(), {
      config: config({ baseUrl: server.url }),
      apiKey: 'k'
    })

    const contentType = server.requests[0].headers['content-type'] ?? ''
    expect(contentType).toContain('multipart/form-data')
    expect(contentType).toContain('boundary=')
  })

  it('地址末尾有斜杠也不会拼出双斜杠', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaTranscriptions(fakeWav(), {
      config: config({ baseUrl: `${server.url}/` }),
      apiKey: 'k'
    })

    expect(server.requests[0].url).toBe('/audio/transcriptions')
  })
})

describe('聊天接口的请求格式', () => {
  it('发到 {base}/chat/completions', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaChatAudio(fakeWav(), {
      config: config({ baseUrl: server.url, apiType: 'chat-audio' }),
      apiKey: 'sk-test'
    })

    expect(server.requests[0].url).toBe('/chat/completions')
  })

  it('stream 设为 false', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaChatAudio(fakeWav(), {
      config: config({ baseUrl: server.url, apiType: 'chat-audio' }),
      apiKey: 'k'
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.stream).toBe(false)
  })

  it('content 是 input_audio 内容块，data 是 data URI', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaChatAudio(fakeWav(), {
      config: config({ baseUrl: server.url, apiType: 'chat-audio' }),
      apiKey: 'k'
    })

    const body = server.requests[0].body as Record<string, unknown>
    const messages = body.messages as Array<Record<string, unknown>>
    const content = messages[0].content as Array<Record<string, unknown>>

    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(content[0].type).toBe('input_audio')

    const audio = content[0].input_audio as Record<string, unknown>
    expect(typeof audio.data).toBe('string')
    expect(audio.data as string).toMatch(/^data:audio\/wav;base64,/)
  })

  it('语言是"自动"时不带 asr_options', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaChatAudio(fakeWav(), {
      config: config({ baseUrl: server.url, language: 'auto' }),
      apiKey: 'k'
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.asr_options).toBeUndefined()
  })

  it('指定中文时带 asr_options.language = zh', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaChatAudio(fakeWav(), {
      config: config({ baseUrl: server.url, language: 'zh' }),
      apiKey: 'k'
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.asr_options).toEqual({ language: 'zh' })
  })

  it('指定英文时带 asr_options.language = en', async () => {
    server = await startMockServer({ format: 'openai', reply: '识别结果' })
    await transcribeViaChatAudio(fakeWav(), {
      config: config({ baseUrl: server.url, language: 'en' }),
      apiKey: 'k'
    })

    const body = server.requests[0].body as Record<string, unknown>
    expect(body.asr_options).toEqual({ language: 'en' })
  })
})

describe('错误处理沿用第五节的中文对照表', () => {
  it('401 提示 API Key 不正确', async () => {
    server = await startMockServer({ format: 'openai', status: 401 })
    await expect(
      transcribeViaTranscriptions(fakeWav(), {
        config: config({ baseUrl: server.url }),
        apiKey: 'bad'
      })
    ).rejects.toMatchObject({ message: 'API Key 不正确或没有权限' })
  })

  it('404 提示地址可能有误', async () => {
    server = await startMockServer({ format: 'openai', status: 404 })
    await expect(
      transcribeViaTranscriptions(fakeWav(), {
        config: config({ baseUrl: server.url }),
        apiKey: 'k'
      })
    ).rejects.toMatchObject({ message: '地址或模型名可能有误' })
  })

  it('429 提示请求太频繁', async () => {
    server = await startMockServer({ format: 'openai', status: 429 })
    await expect(
      transcribeViaChatAudio(fakeWav(), {
        config: config({ baseUrl: server.url }),
        apiKey: 'k'
      })
    ).rejects.toMatchObject({ message: '请求太频繁或额度不足' })
  })

  it('500 提示服务商暂时出错', async () => {
    server = await startMockServer({ format: 'openai', status: 500 })
    await expect(
      transcribeViaTranscriptions(fakeWav(), {
        config: config({ baseUrl: server.url }),
        apiKey: 'k'
      })
    ).rejects.toMatchObject({ message: '服务商暂时出错' })
  })

  it('连不上时提示网络连接失败', async () => {
    await expect(
      transcribeViaTranscriptions(fakeWav(), {
        config: config({ baseUrl: 'http://127.0.0.1:1' }),
        apiKey: 'k'
      })
    ).rejects.toMatchObject({ message: '网络连接失败' })
  })
})

// ---------- 界面结构 ----------

describe('麦克风按钮的位置和显示条件', () => {
  const area = read('src/renderer/components/EditorArea.tsx')

  it('浮在输入框右下角', () => {
    const mic = read('src/renderer/components/MicButton.tsx')
    expect(mic).toContain("position: 'absolute'")
    expect(mic).toContain("right: '10px'")
    expect(mic).toContain("bottom: '10px'")
  })

  it('编辑器底部留出了空间，不会盖住文字', () => {
    const editor = read('src/renderer/components/IntentEditor.tsx')
    // 底部内边距要比左右大，给麦克风按钮腾地方
    expect(editor).toContain("'& .cm-content': { padding: '8px 12px 44px' }")
  })

  it('只在原文标签页渲染', () => {
    // 麦克风按钮在 activeTab === 'source' 的分支里
    const sourceBranch = area.slice(
      area.indexOf("activeTab === 'source' ?"),
      area.indexOf('<MicButton')
    )
    expect(sourceBranch).toContain('editorWrap')
  })

  it('优化进行中时禁用', () => {
    expect(area).toContain('disabled={optimizing')
  })

  it('悬停提示写明了用法', () => {
    const mic = read('src/renderer/components/MicButton.tsx')
    expect(mic).toContain('语音输入（点击开始，按任意键或点击鼠标停止）')
  })
})

describe('按钮的三种状态', () => {
  const mic = read('src/renderer/components/MicButton.tsx')

  it('录音中显示计时和音量条', () => {
    expect(mic).toContain('formatDuration(elapsed)')
    expect(mic).toContain('styles.meter')
  })

  it('录音中有呼吸动画', () => {
    expect(mic).toContain('animationName')
    expect(mic).toContain('infinite')
  })

  it('识别中显示转圈和"识别中…"', () => {
    expect(mic).toContain('识别中…')
    expect(mic).toContain('styles.spinner')
  })

  it('识别中可以点击取消', () => {
    expect(mic).toContain('onCancel')
  })
})

describe('录音实现', () => {
  const recorder = read('src/renderer/recorder.ts')

  it('用 getUserMedia，单声道 + 回声消除 + 降噪', () => {
    expect(recorder).toContain('getUserMedia')
    expect(recorder).toContain('channelCount: 1')
    expect(recorder).toContain('echoCancellation: true')
    expect(recorder).toContain('noiseSuppression: true')
  })

  it('用 AudioWorklet 采集', () => {
    expect(recorder).toContain('AudioWorkletNode')
    expect(recorder).toContain('audioWorklet.addModule')
  })

  it('重采样到 16kHz 并编码成 16 位 PCM WAV', () => {
    expect(recorder).toContain('resample(merged, inputRate, TARGET_SAMPLE_RATE)')
    expect(recorder).toContain('encodeWav')
    expect(recorder).toContain('setInt16')
    expect(recorder).toContain("'RIFF'")
  })

  it('停止后立刻关掉所有音轨', () => {
    expect(recorder).toContain('track.stop()')
  })

  it('不写磁盘（没有任何文件写入调用）', () => {
    expect(recorder).not.toContain('writeFile')
    expect(recorder).not.toContain('createWriteStream')
    expect(recorder).not.toContain('require(')
  })

  it('麦克风错误的提示是中文的', () => {
    expect(recorder).toContain('麦克风权限被关闭')
    expect(recorder).toContain('Windows 设置 → 隐私和安全性 → 麦克风')
    expect(recorder).toContain('没有找到麦克风')
  })
})

describe('停止录音的拦截', () => {
  const hook = read('src/renderer/useVoiceInput.ts')

  it('在捕获阶段监听 keydown 和 mousedown', () => {
    expect(hook).toContain("addEventListener('keydown', onKeyDown, true)")
    expect(hook).toContain("addEventListener('mousedown', onMouseDown, true)")
  })

  it('阻止默认行为并停止传播（按键不会输入、点击不会触发按钮）', () => {
    expect(hook).toContain('event.preventDefault()')
    expect(hook).toContain('event.stopPropagation()')
  })

  it('Esc 停止并放弃，不识别', () => {
    expect(hook).toContain("event.key === 'Escape'")
    expect(hook).toContain('stopAndTranscribe(true)')
  })

  it('开始录音的那一次点击不会被当成停止（延迟挂监听）', () => {
    expect(hook).toContain('setTimeout')
    expect(hook).toContain('开始录音的那一次点击不能被当成停止')
  })

  it('窗口隐藏或失焦时停止', () => {
    expect(hook).toContain("addEventListener('blur'")
    expect(hook).toContain('visibilitychange')
  })

  it('录满最长时长自动停止', () => {
    expect(hook).toContain('seconds >= maxSecondsRef.current')
  })

  it('输入法组字时不误判', () => {
    expect(hook).toContain('event.isComposing')
  })
})

describe('插入文字', () => {
  const editor = read('src/renderer/components/IntentEditor.tsx')

  it('插在光标处，有选中就替换', () => {
    expect(editor).toContain('const { from, to } = view.state.selection.main')
    expect(editor).toContain('changes: { from, to, insert: text }')
  })

  it('整次插入是一步撤销操作', () => {
    // 一次 dispatch，Ctrl+Z 一次就能撤回
    expect(editor).toContain("userEvent: 'input.voice'")
  })

  it('结果为空时不插入', () => {
    const hook = read('src/renderer/useVoiceInput.ts')
    expect(hook).toContain('EMPTY_RESULT_MESSAGE')
    expect(hook).toContain('if (!text)')
  })

  it('插入前先清理标签', () => {
    const hook = read('src/renderer/useVoiceInput.ts')
    expect(hook).toContain('cleanTranscript(result.text)')
  })
})

describe('网络请求在主进程发出', () => {
  it('界面进程不直接发请求', () => {
    const hook = read('src/renderer/useVoiceInput.ts')
    expect(hook).not.toContain('fetch(')
    expect(hook).not.toContain('XMLHttpRequest')
    // 只通过 IPC 交给主进程
    expect(hook).toContain('window.preface.transcribeAudio')
  })

  it('主进程有 IPC 处理', () => {
    const ipc = read('src/main/ipc.ts')
    expect(ipc).toContain("'speech:transcribe'")
    expect(ipc).toContain("'speech:cancel'")
  })

  it('麦克风权限只放行本程序的窗口', () => {
    const index = read('src/main/index.ts')
    expect(index).toContain('setPermissionRequestHandler')
    expect(index).toContain("permission !== 'media'")
  })
})

describe('引擎接口（为以后的本地模型留位置）', () => {
  const index = read('src/main/speech/index.ts')

  it('定义了统一的引擎接口', () => {
    const speech = read('src/shared/speech.ts')
    expect(speech).toContain('export interface SpeechEngine')
    expect(speech).toContain('transcribe(')
  })

  it('在线 API 是它的一种实现', () => {
    expect(index).toContain('const onlineApiEngine: SpeechEngine')
  })

  it('引擎通过一个函数获取，方便以后按设置切换', () => {
    expect(index).toContain('function currentEngine()')
  })

  it('注释说明了以后怎么加本地模型', () => {
    expect(index).toContain('sherpa-onnx')
  })
})

describe('设置页的语音标签', () => {
  const tab = read('src/renderer/components/settings/SpeechTab.tsx')
  const dialog = read('src/renderer/components/SettingsDialog.tsx')

  it('设置窗口里有"语音"标签', () => {
    expect(dialog).toContain('<Tab value="speech">语音</Tab>')
  })

  it('有全部要求的设置项', () => {
    expect(tab).toContain('服务商预设')
    expect(tab).toContain('Base URL')
    expect(tab).toContain('API Key')
    expect(tab).toContain('模型')
    expect(tab).toContain('接口类型')
    expect(tab).toContain('识别语言')
    expect(tab).toContain('最长录音时长')
  })

  it('有测试按钮，录 3 秒', () => {
    expect(tab).toContain('TEST_SECONDS = 3')
    expect(tab).toContain('录 3 秒并识别')
  })

  it('测试会显示耗时', () => {
    expect(tab).toContain('testElapsed')
  })

  it('选预设会自动填好地址、模型和接口类型', () => {
    expect(tab).toContain('baseUrl: preset.baseUrl')
    expect(tab).toContain('model: preset.model')
    expect(tab).toContain('apiType: preset.apiType')
  })

  it('API Key 与提示词优化的 Key 分开存放', () => {
    const index = read('src/main/speech/index.ts')
    expect(index).toContain("SPEECH_SECRET_ID = 'speech'")
  })
})
