'use client'

import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  DataTable,
  Heading,
  Panel,
  Stats,
  Timeline,
} from '../../components/shared'
import { isEscalatedDispute } from '../../context/disputes'
import { date, serverNow, useStore } from '../../context/MockStoreContext'

export function AdminExamDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { state } = useStore()
  const exam = state.exams.find((record) => record.id === id)
  const back = (
    <Button secondary to="/admin/oversight">
      Platform oversight
    </Button>
  )
  if (!exam) return <Heading title="Examination unavailable" actions={back} />

  const attempts = state.attempts.filter((attempt) => attempt.exam === id)
  const outages = state.outages.filter((outage) => outage.exam === id)
  const escalations = state.disputes.filter(
    (dispute) => dispute.exam === id && isEscalatedDispute(dispute),
  )
  const examiner = state.users.find((user) => user.id === exam.owner)
  const now = serverNow()

  return (
    <>
      <Heading
        title={exam.title}
        subtitle={exam.subject + ' · Examination oversight'}
        actions={back}
      />
      <Stats
        items={[
          ['Enrolled', exam.candidates.length],
          [
            'Active attempts',
            attempts.filter(
              (attempt) => !attempt.submitted && attempt.end > now,
            ).length,
          ],
          [
            'Synced submissions',
            attempts.filter((attempt) => attempt.submitted && !attempt.pending)
              .length,
          ],
          [
            'Open escalations',
            escalations.filter((dispute) => dispute.status === 'Escalated')
              .length,
          ],
        ]}
      />
      <div className="two-col">
        <Panel title="Lifecycle and schedule">
          <Badge>{exam.status}</Badge>
          <p>
            <strong>Examiner</strong> · {examiner?.name ?? 'Unassigned'}
          </p>
          <p>
            <strong>Opens</strong> · {date(exam.date)}
          </p>
          <p>
            <strong>Closes</strong> · {date(exam.close)}
          </p>
          <p>
            <strong>Duration</strong> · {exam.duration} min
          </p>
          <p>
            <strong>Results</strong> ·{' '}
            {exam.released ? 'Published' : 'Unpublished'}
          </p>
        </Panel>
        <Panel title="Recorded outages">
          <Timeline
            events={outages.map((outage) => ({
              at: outage.at,
              type: 'Outage',
              message:
                outage.cohort + ' · ' + outage.minutes + ' min extension',
            }))}
          />
        </Panel>
      </div>
      <Panel title="Escalated appeals">
        <DataTable
          columns={['Type', 'Candidate', 'Status', 'Action']}
          rows={escalations.map((dispute) => {
            const name =
              state.users.find((user) => user.id === dispute.user)?.name ??
              'Unknown'
            return {
              key: dispute.id,
              search: dispute.type + ' ' + name,
              cells: [
                dispute.type,
                name,
                <Badge>{dispute.status}</Badge>,
                <Button secondary to={'/admin/disputes/' + dispute.id}>
                  View case
                </Button>,
              ],
            }
          })}
        />
      </Panel>
    </>
  )
}
