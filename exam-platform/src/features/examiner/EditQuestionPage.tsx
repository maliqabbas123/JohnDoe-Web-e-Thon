'use client'

import { useParams } from 'next/navigation'
import { isLive } from '@/lib/api'
import { LiveQuestionEditor } from './LiveQuestionEditor'
import { useStore } from '../../context/MockStoreContext'

import { Missing, QuestionEditor } from './shared'

export function EditQuestionPage() {
  const { id } = useParams<{ id: string }>()
  return isLive ? (
    <LiveQuestionEditor key={id} id={id} />
  ) : (
    <DemoQuestionEditor id={id} />
  )
}

function DemoQuestionEditor({ id }: { id: string }) {
  const { state } = useStore(),
    q = state.questions.find((q) => q.id === id)
  return q ? <QuestionEditor key={id} original={q} /> : <Missing />
}
