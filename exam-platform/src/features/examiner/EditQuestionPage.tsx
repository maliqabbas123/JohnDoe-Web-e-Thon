'use client'

import { useParams } from 'next/navigation'
import { useStore } from '../../context/MockStoreContext'

import { Missing, QuestionEditor } from './shared'

export function EditQuestionPage() {
  const { id } = useParams<{ id: string }>(),
    { state } = useStore(),
    q = state.questions.find((q) => q.id === id)
  return q ? <QuestionEditor key={id} original={q} /> : <Missing />
}
