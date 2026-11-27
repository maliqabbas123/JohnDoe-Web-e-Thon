'use client'

import { Button, Heading, Panel } from '../../components/shared'

import { Missing, displayAnswer, useExam } from './shared'

export function ExamAnswerReviewPage() {
  const { exam, attempt, state, base } = useExam()
  if (!exam?.released || !attempt?.submitted || attempt.pending)
    return <Missing />
  return (
    <>
      <Heading
        title="Answer walkthrough"
        subtitle={exam.title}
        actions={
          <Button secondary to={base + '/result'}>
            Scorecard
          </Button>
        }
      />
      {exam.paper.map((p, i) => {
        const q = (attempt.questions ?? state.questions).find(
          (q) => q.id === p.id,
        )
        if (!q) return null
        return (
          <Panel key={p.id} title={'Question ' + (i + 1)}>
            <p>{q.prompt}</p>
            <p>
              <strong>Your response</strong> ·{' '}
              {displayAnswer(q, attempt.answers[q.id])}
            </p>
            <p>
              <strong>
                {q.kind === 'Written Response' ? 'Rubric' : 'Correct response'}
              </strong>{' '}
              · {q.rubric || displayAnswer(q, q.correct)}
            </p>
            {attempt.grades[q.id] && (
              <p>
                <strong>Feedback</strong> · {attempt.grades[q.id].feedback}
              </p>
            )}
          </Panel>
        )
      })}
    </>
  )
}
