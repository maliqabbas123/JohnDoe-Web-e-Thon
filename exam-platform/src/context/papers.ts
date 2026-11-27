import type { Attempt, Difficulty, Exam, Question } from '../types'

export const variants = ['A', 'B', 'C'] as const
export const difficulties: Difficulty[] = ['Easy', 'Medium', 'Hard']

export function quotaCounts(
  weights: Record<string, number>,
  keys: string[],
  count: number,
) {
  const quotas = keys.map((key) => {
    const exact = (count * (weights[key] ?? 0)) / 100
    return { key, count: Math.floor(exact), fraction: exact % 1 }
  })
  const remaining = count - quotas.reduce((sum, entry) => sum + entry.count, 0)
  const ranked = [...quotas].sort((a, b) => b.fraction - a.fraction)
  for (const entry of ranked.slice(0, Math.max(0, remaining))) entry.count++
  return Object.fromEntries(quotas.map((entry) => [entry.key, entry.count]))
}

export function variantPapers(
  exam: Exam,
  questions: Question[],
  weights: Record<string, number>,
) {
  const lookup = new Map(questions.map((question) => [question.id, question]))
  const paper = exam.paper.map((item) => lookup.get(item.id))
  const topics = [...new Set(questions.map((question) => question.topic))]
  if (!paper.length || paper.some((question) => !question))
    throw Error('Assign a complete examination paper first.')
  for (const [dimension, keys] of [
    ['difficulty', difficulties],
    ['topic', topics],
  ] as const) {
    const counts = quotaCounts(weights, keys, paper.length)
    if (
      keys.some(
        (key) =>
          counts[key] !==
          paper.filter((question) => question?.[dimension] === key).length,
      )
    ) {
      throw Error(
        'Adjust the assigned paper in the paper builder to match the rounded ' +
          dimension +
          ' quotas.',
      )
    }
  }
  const original = new Set(exam.paper.map((item) => item.id))
  return Object.fromEntries(
    variants.map((variant, index) => {
      const used = new Set<string>()
      return [
        variant,
        exam.paper.map((item) => {
          const assigned = lookup.get(item.id)!
          const alternatives = [
            assigned,
            ...questions.filter(
              (question) =>
                !original.has(question.id) &&
                question.difficulty === assigned.difficulty &&
                question.topic === assigned.topic &&
                question.kind === assigned.kind &&
                !used.has(question.id),
            ),
          ]
          const selected = alternatives[index % alternatives.length]
          used.add(selected.id)
          return { ...item, id: selected.id }
        }),
      ]
    }),
  )
}

export function questionsForAttempt(
  attempt: Attempt | undefined,
  bank: Question[],
) {
  return attempt?.questions ?? bank
}
