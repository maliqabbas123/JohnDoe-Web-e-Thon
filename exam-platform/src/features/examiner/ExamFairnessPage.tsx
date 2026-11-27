'use client'

import { useState } from 'react'
import { Button, DataTable, Field, Panel } from '../../components/shared'
import { finalScore, serverNow } from '../../context/MockStoreContext'

import { ExamHeader, Missing, useExam } from './shared'

export function ExamFairnessPage() {
  const { exam, attempts, state, update, toast } = useExam(),
    [adjustment, set] = useState<number>()
  if (!exam) return <Missing />
  return (
    <>
      <ExamHeader exam={exam} title="Randomized paper fairness" />
      <Panel title="Variant comparison">
        <p>
          Difficulty scale: 1 Easy, 2 Medium, 3 Hard. Compare the questions and
          observed scores for each saved paper variant.
        </p>
        <DataTable
          columns={[
            'Variant',
            'Submissions',
            'Mean difficulty',
            'Mean score',
            'Score range',
          ]}
          rows={['A', 'B', 'C'].map((v) => {
            const paper =
              attempts.find((a) => a.variant === v)?.paper ??
              exam.variants?.[v] ??
              exam.paper
            const difficulty =
              paper.reduce((sum, p) => {
                const level = state.questions.find(
                  (q) => q.id === p.id,
                )?.difficulty
                return sum + (level === 'Easy' ? 1 : level === 'Medium' ? 2 : 3)
              }, 0) / (paper.length || 1)
            const scores = attempts
              .filter((a) => a.variant === v && a.submitted && !a.pending)
              .map((a) => finalScore(exam, a, state.questions))
            return {
              key: v,
              search: 'Variant ' + v,
              cells: [
                'Variant ' + v,
                scores.length,
                difficulty.toFixed(2),
                scores.length
                  ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(
                      1,
                    )
                  : '—',
                scores.length
                  ? Math.min(...scores).toFixed(1) +
                    ' – ' +
                    Math.max(...scores).toFixed(1)
                  : '—',
              ],
            }
          })}
        />
      </Panel>
      <Panel title="Score distributions by variant">
        {['A', 'B', 'C'].map((variant) => {
          const scores = attempts
            .filter((a) => a.variant === variant && a.submitted && !a.pending)
            .map((a) => finalScore(exam, a, state.questions))
          return (
            <section key={variant}>
              <h3>Variant {variant}</h3>
              {scores.length ? (
                [0, 25, 50, 75].map((low) => {
                  const count = scores.filter((score) => {
                    const pct = Math.min(99.99, (100 * score) / exam.total)
                    return pct >= low && pct < low + 25
                  }).length
                  return (
                    <div className="metric" key={low}>
                      <span>
                        {low}–{low + 25}%
                      </span>
                      <progress max={scores.length} value={count} />
                      <span>{count}</span>
                    </div>
                  )
                })
              ) : (
                <p>No synced submissions for this variant.</p>
              )}
            </section>
          )
        })}
      </Panel>
      <Panel title="Score normalization">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            update((s) => {
              s.exams.find((x) => x.id === exam.id)!.normalization =
                adjustment ?? exam.normalization
              s.audit.unshift({
                at: serverNow(),
                type: 'Grading',
                message: 'Score normalization updated for ' + exam.title,
              })
            })
            toast('Normalization saved.')
          }}
        >
          <Field label="Points added to each final score">
            <input
              type="number"
              min={-exam.total}
              max={exam.total}
              step=".1"
              required
              value={adjustment ?? exam.normalization}
              onChange={(e) => set(e.target.valueAsNumber)}
            />
          </Field>
          <Button type="submit">Apply adjustment</Button>
        </form>
      </Panel>
    </>
  )
}
