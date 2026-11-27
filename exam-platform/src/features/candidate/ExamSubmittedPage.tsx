'use client'

import { RecordHash } from '../../components/shared/RecordHash'

import { Button, Heading, Panel } from '../../components/shared'
import { date } from '../../context/MockStoreContext'

import { Missing, answered, useExam } from './shared'

export function ExamSubmittedPage() {
  const { exam, attempt, base, update } = useExam()
  if (!exam || !attempt?.submitted) return <Missing />
  return (
    <>
      <Heading
        title={
          attempt.pending ? 'Submission saved locally' : 'Examination submitted'
        }
        subtitle={exam.title}
      />
      <Panel title="Submission receipt">
        <p>Submitted {date(attempt.submitted)}</p>
        <p>
          Receipt{' '}
          <RecordHash
            value={JSON.stringify([
              attempt.id,
              exam.id,
              attempt.submitted,
              attempt.answers,
            ])}
          />
        </p>
        <p>
          {Object.values(attempt.answers).filter(answered).length} answers
          recorded.
        </p>
        <p>
          {attempt.pending
            ? 'Reconnect to sync your receipt.'
            : 'Results will appear when the examiner releases them.'}
        </p>
        <div className="actions">
          <Button to="/candidate">My examinations</Button>
          {attempt.pending && (
            <Button secondary to={base + '/recover'}>
              Sync receipt
            </Button>
          )}
          {exam.released && !attempt.pending && (
            <Button secondary to={base + '/result'}>
              View scorecard
            </Button>
          )}
        </div>
      </Panel>
    </>
  )
}
