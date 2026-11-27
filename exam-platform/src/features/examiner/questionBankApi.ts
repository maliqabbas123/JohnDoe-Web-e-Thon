export const questionTypeLabels = {
  SINGLE_CHOICE: 'Single-Answer MCQ',
  MULTIPLE_SELECT: 'Multiple-Select',
  WRITTEN: 'Written Response',
} as const

export const questionDifficultyLabels = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
}

export type QuestionType = keyof typeof questionTypeLabels
export type QuestionDifficulty = keyof typeof questionDifficultyLabels

export type QuestionTopic = {
  id: string
  name: string
  questionCount: number
  byDifficulty: Record<QuestionDifficulty, number>
}

export type OptionInput = { text: string; isCorrect: boolean }

export type BankQuestion = {
  id: string
  type: QuestionType
  difficulty: QuestionDifficulty
  text: string
  explanation: string | null
  defaultMarks: number
  isArchived: boolean
  topic: Pick<QuestionTopic, 'id' | 'name'>
  options: (OptionInput & { id: string; position: number })[]
  usedInExams: number
}

export type QuestionInput = {
  topicId: string
  difficulty: QuestionDifficulty
  text: string
  explanation: string | null
  defaultMarks: number
  options?: OptionInput[]
}

export const questionBankHref = '/examiner/questions'
export const questionApiPath = (id: string) =>
  '/questions/' + encodeURIComponent(id)
export const topicApiPath = (id: string) => '/topics/' + encodeURIComponent(id)

export function questionBankError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'The question bank request failed.'
}
