'use client'

import { isLive } from '@/lib/api'
import { LiveQuestionEditor } from './LiveQuestionEditor'
import { QuestionEditor } from './shared'

export function CreateQuestionPage() {
  return isLive ? <LiveQuestionEditor /> : <QuestionEditor />
}
