'use client'

import { Missing, Setup, useExam } from './shared'

export function ExamSetupPage() {
  const { exam } = useExam()
  return exam ? <Setup key={exam.id} exam={exam} /> : <Missing />
}
