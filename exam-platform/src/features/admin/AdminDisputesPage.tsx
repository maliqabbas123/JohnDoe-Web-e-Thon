'use client'

import {
  Badge,
  Button,
  DataTable,
  Heading,
  Panel,
} from '../../components/shared'
import { isEscalatedDispute } from '../../context/disputes'
import { useStore } from '../../context/MockStoreContext'

export function AdminDisputesPage() {
  const { state } = useStore()
  return (
    <>
      <Heading
        title="Escalated disputes"
        subtitle="Arbitrate appeals referred by an examiner."
      />
      <Panel>
        <DataTable
          columns={['Candidate', 'Examination', 'Type', 'Status', 'Action']}
          filters={{ Status: ['Escalated', 'Resolved'] }}
          rows={state.disputes.filter(isEscalatedDispute).map((d) => {
            const name = state.users.find((u) => u.id === d.user)?.name ?? '',
              exam = state.exams.find((e) => e.id === d.exam)?.title ?? ''
            return {
              key: d.id,
              search: name + ' ' + exam + ' ' + d.type,
              filters: { Status: d.status },
              cells: [
                name,
                exam,
                d.type,
                <Badge>{d.status}</Badge>,
                <Button secondary to={'/admin/disputes/' + d.id}>
                  Review
                </Button>,
              ],
            }
          })}
        />
      </Panel>
    </>
  )
}
