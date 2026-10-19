import { allocateOneId } from '../shared/allocateId'
import type { CorpusResource, TitleSource } from '../shared/types'
import { useStore } from './store'

/**
 * 新建一个语料并加入草稿。
 *
 * 粘贴语料和音频转录共用这一段编号分配逻辑，避免两处各写一遍。
 * titleSource 由调用方给出：手填是 user，AI 生成的是 ai；
 * 不传时按"有标题就是 user"处理（音频转录等现有调用）。
 */
export function addCorpusToDraft(
  title: string,
  content: string,
  titleSource?: TitleSource
): CorpusResource {
  const state = useStore.getState()

  const { id, nextCorpusNo } = allocateOneId(
    {
      files: state.draft.files,
      corpora: state.draft.corpora,
      intentText: state.draft.intentText,
      nextFileNo: state.draft.nextFileNo,
      nextCorpusNo: state.draft.nextCorpusNo
    },
    'corpus'
  )

  const source: TitleSource = title.trim() ? (titleSource ?? 'user') : 'none'

  const corpus: CorpusResource = {
    id,
    title,
    titleSource: source,
    content,
    chars: content.length,
    createdAt: Date.now()
  }

  state.addCorpus(corpus, nextCorpusNo)
  return corpus
}
