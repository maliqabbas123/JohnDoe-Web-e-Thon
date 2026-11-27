'use client'

import { useParams } from 'next/navigation'
import { Badge, Button, Heading, Panel, Stats } from '../../components/shared'
import { useStore } from '../../context/MockStoreContext'

import { Missing, qp } from './shared'

export function QuestionItemAnalyticsPage() {
  const { id } = useParams<{ id: string }>(),
    { state } = useStore(),
    q = state.questions.find((q) => q.id === id)
  if (!q) return <Missing />
  const samples = state.attempts.filter(
      (a) =>
        a.submitted &&
        !a.pending &&
        (a.paper ?? state.exams.find((e) => e.id === a.exam)?.paper)?.some(
          (p) => p.id === id,
        ),
    ),
    skipped = samples.filter((a) => !a.answers[q.id]?.length).length,
    timed = samples.filter((a) => a.itemTime?.[q.id] !== undefined),
    mean =
      timed.reduce((sum, a) => sum + a.itemTime![q.id], 0) /
      (timed.length || 1),
    correct = samples.filter((a) => {
      const v = a.answers[q.id]
      return q.kind === 'Written Response'
        ? (a.grades[q.id]?.score ?? 0) >= q.marks / 2
        : Array.isArray(v) &&
            v.length === q.correct.length &&
            q.correct.every((i) => v.includes(i))
    }).length
  const pct = (n: number) =>
    samples.length ? Math.round((100 * n) / samples.length) + '%' : '—'
  return (
    <>
      <Heading
        title="Item analytics"
        subtitle={q.prompt}
        actions={
          <Button secondary to={qp(q.id) + '/edit'}>
            Edit question
          </Button>
        }
      />
      <Stats
        items={[
          ['Responses', samples.length],
          ['Skip rate', pct(skipped)],
          [
            'Average time per item',
            timed.length ? Math.round(mean / 1000) + ' sec' : '—',
          ],
          ['Observed success', pct(correct)],
        ]}
      />
      <Panel title="Option selection">
        {q.options.length ? (
          q.options.map((o, i) => {
            const n = samples.filter(
              (a) =>
                Array.isArray(a.answers[q.id]) &&
                (a.answers[q.id] as number[]).includes(i),
            ).length
            return (
              <div className="metric" key={i}>
                <span>
                  {o} {q.correct.includes(i) && <Badge>Correct</Badge>}
                </span>
                <progress max={samples.length || 1} value={n} />
                <strong>{pct(n)}</strong>
              </div>
            )
          })
        ) : (
          <p>{q.rubric}</p>
        )}
      </Panel>
    </>
  )
}
