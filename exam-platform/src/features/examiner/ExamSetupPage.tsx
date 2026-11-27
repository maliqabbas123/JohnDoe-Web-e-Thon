'use client'

import { isLive } from '@/lib/api'
import { LiveExamSetup } from './LiveExamSetup'

import { Missing, Setup, useExam } from './shared'

function DemoExamSetupPage() {
  const { exam } = useExam()
  return exam ? <Setup key={exam.id} exam={exam} /> : <Missing />
}

export function ExamSetupPage() {
  return isLive ? <LiveExamSetup /> : <DemoExamSetupPage />
}
