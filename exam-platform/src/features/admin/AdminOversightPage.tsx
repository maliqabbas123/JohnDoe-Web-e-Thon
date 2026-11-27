'use client'

import { Badge, DataTable, Heading, Panel, Tabs } from '../../components/shared'
import { date, useStore } from '../../context/MockStoreContext'

import { examStatuses } from './shared'

export function AdminOversightPage() {
  const { state } = useStore()
  return (
    <>
      <Heading
        title="Platform oversight"
        subtitle="Review examinations and system activity."
      />
      <Panel>
        <Tabs
          labels={['All platform examinations', 'System audit & security logs']}
        >
          {(i) =>
            i === 0 ? (
              <DataTable
                columns={[
                  'Examination',
                  'Examiner',
                  'Status',
                  'Opens',
                  'Candidates',
                ]}
                filters={{ Status: examStatuses }}
                rows={state.exams.map((e) => ({
                  key: e.id,
                  search: e.title + ' ' + e.subject,
                  filters: { Status: e.status },
                  cells: [
                    e.title,
                    state.users.find((u) => u.id === e.owner)?.name,
                    <Badge>{e.status}</Badge>,
                    date(e.date),
                    e.candidates.length,
                  ],
                }))}
              />
            ) : (
              <DataTable
                columns={['Time', 'Category', 'Event']}
                filters={{
                  Category: [...new Set(state.audit.map((a) => a.type))],
                }}
                rows={[...state.audit]
                  .sort((a, b) => b.at - a.at)
                  .map((a, i) => ({
                    key: String(i),
                    search: a.message + ' ' + a.type,
                    filters: { Category: a.type },
                    cells: [date(a.at), <Badge>{a.type}</Badge>, a.message],
                  }))}
              />
            )
          }
        </Tabs>
      </Panel>
    </>
  )
}
