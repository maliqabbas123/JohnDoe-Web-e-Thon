'use client'

import { Badge, Button, Heading, Panel, Stats } from '../../components/shared'
import { approvedAccommodation } from '../../context/accommodations'
import { date } from '../../context/MockStoreContext'
import { Missing, useExam } from './shared'

export function ExamAccommodationsPage() {
  const { exam, user, state, base, attempt } = useExam()
  if (!exam || !user || exam.status === 'Draft') return <Missing />

  const approval = approvedAccommodation(state, exam.id, user.id)
  const appliedMinutes = attempt?.accommodationMinutes ?? 0

  return (
    <>
      <Heading
        title="Exam accommodations"
        subtitle={exam.title}
        actions={
          <Button secondary to={base + '/lobby'}>
            Exam lobby
          </Button>
        }
      />
      <Panel title="Approved adjustments">
        {approval ? (
          <>
            <Badge>Approved</Badge>
            <Stats
              items={[
                ['Standard duration', exam.duration + ' min'],
                ['Additional time', approval.extraMinutes + ' min'],
                [
                  'Maximum duration',
                  exam.duration + approval.extraMinutes + ' min',
                ],
              ]}
            />
            <p>{approval.note}</p>
            <p>Approved {date(approval.approvedAt)}.</p>
          </>
        ) : (
          <p>There are no approved adjustments for this examination.</p>
        )}
        {attempt ? (
          <p>
            {appliedMinutes > 0
              ? appliedMinutes +
                ' approved extra minutes were applied when your attempt started.'
              : 'Your saved attempt has no accommodation time applied.'}
          </p>
        ) : (
          <p>
            Approved extra time is applied when you start. Enter the exam before
            the standard closing time of {date(exam.close)}.
          </p>
        )}
      </Panel>
    </>
  )
}
