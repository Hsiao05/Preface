import type { Draft } from '../../src/shared/types'

/**
 * 一份用于手动验证的示例草稿。
 * 通过 `npm run dev:sample` 写入当前草稿文件，重启窗口即可看到效果。
 */
export function sampleDraft(testDir: string): Draft {
  const join = (name: string): string => `${testDir}\\${name}`

  return {
    id: 'd_20261015_163000',
    status: 'editing',
    intentText: '请根据 @C1 的反馈修改 @F1 的第二部分，用语参考 @F2。',
    files: [
      {
        id: 'F1',
        name: '2024年报初稿.docx',
        path: join('2024年报初稿.docx'),
        ext: 'docx',
        size: 13,
        mtime: 1760000000000,
        note: '待修改的原稿',
        permission: 'editable'
      },
      {
        id: 'F2',
        name: '品牌规范.pdf',
        path: join('品牌规范.pdf'),
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
}
