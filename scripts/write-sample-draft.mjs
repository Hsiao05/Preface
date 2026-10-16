/**
 * 写一份示例草稿到开发环境的 userData，方便手动验证。
 * 用法：node scripts/write-sample-draft.mjs
 */
import { writeFileSync, mkdirSync, existsSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

const TEST_DIR = join(homedir(), 'AppData', 'Local', 'Temp', 'preface-test')
const DRAFT_FILE = join(homedir(), 'AppData', 'Roaming', 'preface-dev', 'drafts', 'current.json')

const joinPath = (name) => `${TEST_DIR}\\${name}`

const draft = {
  id: 'd_20261015_163000',
  status: 'editing',
  intentText: '请根据 @C1 的反馈修改 @F1 的第二部分，用语参考 @F2。',
  files: [
    {
      id: 'F1',
      name: '2024年报初稿.docx',
      path: joinPath('2024年报初稿.docx'),
      ext: 'docx',
      size: 13,
      mtime: 1760000000000,
      note: '待修改的原稿',
      permission: 'editable'
    },
    {
      id: 'F2',
      name: '品牌规范.pdf',
      path: joinPath('品牌规范.pdf'),
      ext: 'pdf',
      size: 7,
      mtime: 1760000000000,
      note: '用语和排版参考',
      permission: 'readonly'
    }
  ],
  corpora: [
    {
      id: 'C1',
      title: '客户口头反馈整理',
      titleSource: 'user',
      content: '客户说第二部分太长了，语气也不太合适。',
      chars: 19,
      createdAt: 1760000000000
    }
  ],
  nextFileNo: 3,
  nextCorpusNo: 2,
  target: 'local',
  mode: 'auto',
  styleId: 'clear-direct',
  replyFormat: 'none',
  optimization: null,
  result: null,
  lastAction: null,
  updatedAt: Date.now()
}

// 先备份已有的草稿，方便恢复
if (existsSync(DRAFT_FILE)) {
  copyFileSync(DRAFT_FILE, `${DRAFT_FILE}.before-sample`)
  console.log('已备份原有草稿到 current.json.before-sample')
}

mkdirSync(dirname(DRAFT_FILE), { recursive: true })
writeFileSync(DRAFT_FILE, JSON.stringify(draft, null, 2), 'utf-8')
console.log('已写入示例草稿:', DRAFT_FILE)
console.log('重启窗口（npm run dev）即可看到效果。')
