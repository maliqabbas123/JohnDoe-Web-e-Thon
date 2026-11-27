'use client'

import { Badge, Button, DataTable, Panel } from '../../components/shared'

import { ExamHeader, Missing, disputeStates, useExam } from './shared'

export function ExamDisputesQueuePage() {
  const { state, exam, base } = useExam()
  if (!exam) return <Missing />
  return (
    <>
      <ExamHeader exam={exam} title="Examination disputes" />
      <Panel>
        <DataTable
          columns={['Candidate', 'Type', 'Claim', 'State', 'Action']}
          filters={{ Status: disputeStates }}
          rows={state.disputes
            .filter((d) => d.exam === exam.id)
            .map((d) => {
              const name = state.users.find((u) => u.id === d.user)?.name ?? ''
              return {
                key: d.id,
                search: name + ' ' + d.claim + ' ' + d.type,
                filters: { Status: d.status },
                cells: [
                  name,
                  d.type,
                  d.claim,
                  <Badge>{d.status}</Badge>,
                  <Button secondary to={base + '/disputes/' + d.id}>
                    Review evidence
                  </Button>,
                ],
              }
            })}
        />
      </Panel>
    </>
  )
}
