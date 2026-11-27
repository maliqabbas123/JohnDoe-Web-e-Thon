export type Role = 'Administrator' | 'Examiner' | 'Candidate'
export type Status = 'Draft' | 'Published' | 'Ongoing' | 'Completed'
export type Kind = 'Single-Answer MCQ' | 'Multiple-Select' | 'Written Response'
export type Difficulty = 'Easy' | 'Medium' | 'Hard'
export interface User {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  password: string
  history: string[]
  logins: number[]
  revokedAt?: number
}
export interface Question {
  id: string
  prompt: string
  topic: string
  difficulty: Difficulty
  kind: Kind
  options: string[]
  correct: number[]
  rubric: string
  partial: boolean
  marks: number
}
export interface Exam {
  id: string
  owner: string
  title: string
  subject: string
  status: Status
  date: string
  close: string
  duration: number
  total: number
  instructions: string
  shuffle: boolean
  shuffleOptions: boolean
  paper: { id: string; marks: number }[]
  candidates: string[]
  released: boolean
  blueprint: Record<string, number>
  normalization: number
  variants?: Record<string, { id: string; marks: number }[]>
}
export type Answer = string | number[]
export interface Incident {
  at: number
  message: string
  type: string
}
export interface Attempt {
  id: string
  exam: string
  user: string
  start: number
  end: number
  submitted?: number
  answers: Record<string, Answer>
  grades: Record<string, { score: number; feedback: string }>
  flags: string[]
  scratch: string
  incidents: Incident[]
  grace: number
  accommodationMinutes?: number
  review: string
  pending: boolean
  variant: string
  code: string
  network?: 'Online' | 'Unstable' | 'Offline'
  itemTime?: Record<string, number>
  lastAnswerAt?: number
  paper?: Exam['paper']
  questions?: Question[]
}
export interface Dispute {
  id: string
  exam: string
  user: string
  question: string
  type: string
  claim: string
  evidence?: string
  status: string
  notes: string
  revisions: { at: number; summary: string; status?: string }[]
}
export interface CohortReport {
  id: string
  exam: string
  title: string
  generatedAt: number
  total: number
  scores: { name: string; points: number }[]
}

export interface Accommodation {
  exam: string
  user: string
  extraMinutes: number
  approvedAt: number
  note: string
}

export interface State {
  users: User[]
  exams: Exam[]
  questions: Question[]
  attempts: Attempt[]
  disputes: Dispute[]
  cohortReports?: CohortReport[]
  accommodations?: Accommodation[]
  audit: Incident[]
  messages: { exam: string; body: string; at: number }[]
  outages: { cohort: string; minutes: number; exam: string; at: number }[]
  policy: {
    timeout: number
    password: number
    importLimit: number
    threshold: number
    incidents: boolean
  }
  tokens: Record<string, { user: string; purpose: 'invite' | 'reset' }>
  preferences: Record<
    string,
    { size: string; contrast: boolean; split: boolean }
  >
}
