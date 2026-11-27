import type { Exam, State } from '../types'

export function approvedAccommodation(
  state: State,
  examId: string,
  userId: string,
) {
  return state.accommodations?.find(
    (entry) => entry.exam === examId && entry.user === userId,
  )
}

export function accommodatedDeadline(
  exam: Exam,
  start: number,
  extraMinutes: number,
) {
  const minute = 60000
  return Math.min(
    start + (exam.duration + extraMinutes) * minute,
    new Date(exam.close).getTime() + extraMinutes * minute,
  )
}
