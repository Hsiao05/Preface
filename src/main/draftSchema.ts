import { z } from 'zod'

/** 草稿的校验规则。与 src/shared/types.ts 里的 Draft 保持一致。 */
export const draftSchema = z.object({
  id: z.string(),
  status: z.enum(['editing', 'copied']),
  intentText: z.string(),
  files: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      ext: z.string(),
      size: z.number(),
      mtime: z.number(),
      note: z.string(),
      permission: z.enum(['editable', 'readonly'])
    })
  ),
  corpora: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      titleSource: z.enum(['user', 'ai', 'none']),
      content: z.string(),
      chars: z.number(),
      createdAt: z.number()
    })
  ),
  nextFileNo: z.number().int().min(1),
  nextCorpusNo: z.number().int().min(1),
  target: z.enum(['local', 'web']),
  mode: z.enum(['auto', 'simple', 'markdown']),
  styleId: z.string(),
  replyFormat: z.enum(['none', 'markdown', 'plain']),
  optimization: z
    .object({
      messages: z.array(
        z.object({ role: z.enum(['user', 'assistant']), content: z.string() })
      ),
      intent: z.string(),
      resolvedMode: z.enum(['simple', 'markdown']).nullable(),
      questions: z.array(
        z.object({
          no: z.number(),
          question: z.string(),
          options: z.array(z.string())
        })
      ),
      answers: z.record(
        z.string(),
        z.object({
          state: z.enum(['chosen', 'custom', 'delegated']),
          value: z.string()
        })
      ),
      intentCorrection: z.string().nullable(),
      usage: z
        .object({
          input: z.number(),
          output: z.number(),
          cached: z.number(),
          estimated: z.boolean()
        })
        .nullable()
    })
    .nullable(),
  result: z
    .object({
      text: z.string(),
      editedByUser: z.boolean(),
      stale: z.boolean()
    })
    .nullable(),
  lastAction: z.enum(['optimize', 'tidy']).nullable(),
  /**
   * 连续触发"模型未按格式输出"兜底的次数。
   * 用户改过提示词后连续两次兜底，就提示他检查提示词。
   */
  fallbackStreak: z.number().int().min(0).default(0),
  /**
   * 本轮选中的 Prompt 库条目快照。旧草稿没有这个字段，缺省为 null。
   * 这里放宽长度上限只做结构校验，真正的上限在保存库条目时检查。
   */
  promptSelection: z
    .object({
      id: z.string(),
      title: z.string(),
      content: z.string(),
      mode: z.enum(['reference', 'template'])
    })
    .nullable()
    .default(null),
  updatedAt: z.number()
})
