'use client'

import { isLive } from '@/lib/api'
import { LiveExamSetup } from './LiveExamSetup'

import { Blueprint, Missing, useExam } from './shared'

function DemoExamBlueprintPage() {
  const { exam } = useExam()
  return exam ? <Blueprint key={exam.id} exam={exam} /> : <Missing />
}

export function ExamBlueprintPage() {
  return isLive ? <LiveExamSetup paperFirst /> : <DemoExamBlueprintPage />
}
