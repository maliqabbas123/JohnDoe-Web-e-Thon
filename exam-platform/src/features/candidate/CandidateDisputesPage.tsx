'use client'

import { Badge, DataTable, Heading, Panel } from '../../components/shared'
import { useStore } from '../../context/MockStoreContext'

export function CandidateDisputesPage() {
  const { state, user } = useStore()
  return (
    <>
      <Heading
        title="My disputes"
        subtitle="Track appeal progress and review decisions."
      />
      <Panel>
        <DataTable
          columns={[
            'Examination',
            'Type',
            'Status',
            'Claim',
            'Resolution notes',
          ]}
          filters={{
            Status: ['Open', 'Under Review', 'Resolved', 'Escalated'],
          }}
          rows={state.disputes
            .filter((d) => d.user === user!.id)
            .map((d) => {
              const exam = state.exams.find((e) => e.id === d.exam)?.title ?? ''
              return {
                key: d.id,
                search: exam + ' ' + d.claim + ' ' + d.type,
                filters: { Status: d.status },
                cells: [
                  exam,
                  d.type,
                  <Badge>{d.status}</Badge>,
                  d.claim,
                  d.notes || 'Awaiting examiner response',
                ],
              }
            })}
        />
      </Panel>
    </>
  )
}
