'use client'

import { useParams } from 'next/navigation'

import { Grade, Missing, useExam } from './shared'

export function ManualGradingPage() {
  const { attemptId } = useParams<{ attemptId: string }>(),
    { exam, attempts } = useExam(),
    a = attempts.find((a) => a.id === attemptId && a.submitted && !a.pending)
  return exam && a ? <Grade key={a.id} exam={exam} attempt={a} /> : <Missing />
}
