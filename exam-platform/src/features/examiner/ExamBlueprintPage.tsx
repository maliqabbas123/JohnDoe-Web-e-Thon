'use client'

import { Blueprint, Missing, useExam } from './shared'

export function ExamBlueprintPage() {
  const { exam } = useExam()
  return exam ? <Blueprint key={exam.id} exam={exam} /> : <Missing />
}
