import { allocateOneId } from '../shared/allocateId'
import type { CorpusResource } from '../shared/types'
import { useStore } from './store'

/**
 * 新建一个语料并加入草稿。
 *
 * 粘贴语料和音频转录共用这一段编号分配逻辑，避免两处各写一遍。
 */
export function addCorpusToDraft(title: string, content: string): CorpusResource {
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

  const corpus: CorpusResource = {
    id,
    title,
    titleSource: title ? 'user' : 'none',
    content,
    chars: content.length,
    createdAt: Date.now()
  }

  state.addCorpus(corpus, nextCorpusNo)
  return corpus
}
