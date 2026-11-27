export const examStates = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ONGOING: 'Ongoing',
  COMPLETED: 'Completed',
}

export const examDifficultyLabels = {
  EASY: 'Easy',
  MEDIUM: 'Medium',
  HARD: 'Hard',
}

export type ExamState = keyof typeof examStates
export type ExamDifficulty = keyof typeof examDifficultyLabels

export interface ExamSettingsInput {
  title: string
  startsAt: string
  endsAt: string
  durationMinutes: number
  totalMarks: number
}

export interface ExamSummary extends ExamSettingsInput {
  id: string
  state: ExamState
  status: Exclude<ExamState, 'ONGOING'>
  selectionMode: 'FIXED' | 'BALANCED'
}

export interface ExamPoolRow {
  questionId: string
  marks: number | null
  position: number
  question: {
    difficulty: ExamDifficulty
    isArchived: boolean
  }
}

export interface ExamDifficultyRule {
  difficulty: ExamDifficulty
  percent: number
  marksEach: number
}

export interface ExamDetail extends ExamSummary {
  instructions: string
  shuffleQuestions: boolean
  shuffleOptions: boolean
  multiSelectScoring: 'ALL_OR_NOTHING' | 'PARTIAL'
  maxAttempts: number | null
  resultPolicy: 'BEST' | 'LATEST'
  disputeWindowHours: number | null
  revealAnswers: boolean
  desktopOnly: boolean
  blockClipboard: boolean
  blockContextMenu: boolean
  requireFullscreen: boolean
  detectExtraDisplay: boolean
  watermark: boolean
  aiNotice: boolean
  honeypot: boolean
  questionCount: number | null
  questions: ExamPoolRow[]
  difficultyRules: ExamDifficultyRule[]
  rules: { statements: string[] }
  joinCode: string | null
}

export interface ExamBankQuestion {
  id: string
  text: string
  difficulty: ExamDifficulty
  defaultMarks: number
}

export interface ExamIssue {
  path: string
  message: string
}

export interface ExamReview {
  canPublish: boolean
  errors: ExamIssue[]
  warnings: ExamIssue[]
  questionCount: number | null
  paperMarks: number | null
  difficulty: (ExamDifficultyRule & { available: number; required: number })[]
}

export const examApiPath = (id: string) => '/exams/' + encodeURIComponent(id)
export const examPagePath = (id: string) =>
  '/examiner/exams/' + encodeURIComponent(id)

export function localDateInput(value: Date | string) {
  const date = new Date(value)
  const localTime = date.getTime() - date.getTimezoneOffset() * 60_000
  return new Date(localTime).toISOString().slice(0, 16)
}

export function formatExamDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function examErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'There was a problem contacting the examination service.'
}

export function examErrorDetails(error: unknown): ExamIssue[] {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('details' in error) ||
    !Array.isArray(error.details)
  )
    return []
  return error.details.filter(
    (detail): detail is ExamIssue =>
      typeof detail === 'object' &&
      detail !== null &&
      typeof detail.path === 'string' &&
      typeof detail.message === 'string',
  )
}
