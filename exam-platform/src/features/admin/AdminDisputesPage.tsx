'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  DataTable,
  Field,
  Heading,
  Modal,
  Panel,
  Timeline,
} from '../../components/shared'
import { serverNow, useStore } from '../../context/MockStoreContext'

export function AdminDisputesPage() {
  const { state, update, toast } = useStore(),
    [selected, set] = useState(''),
    [notes, setNotes] = useState('')
  const d = state.disputes.find((d) => d.id === selected)
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
          rows={state.disputes
            .filter(
              (d) =>
                d.status === 'Escalated' ||
                d.revisions.some((r) => r.summary.includes('administrator')),
            )
            .map((d) => {
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
                  <Button
                    secondary
                    onClick={() => {
                      set(d.id)
                      setNotes(d.notes)
                    }}
                  >
                    Review
                  </Button>,
                ],
              }
            })}
        />
      </Panel>
      {d && (
        <Modal title="Dispute arbitration" close={() => set('')}>
          <p>{d.claim}</p>
          <Timeline
            events={d.revisions.map((r) => ({
              at: r.at,
              type: 'Revision',
              message: r.summary,
            }))}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!notes.trim()) return
              update((s) => {
                const record = s.disputes.find((x) => x.id === d.id)!
                record.status = 'Resolved'
                record.notes = notes
                record.revisions.push({
                  at: serverNow(),
                  summary: 'Resolved by administrator: ' + notes,
                })
              })
              toast('Arbitration decision saved.')
              set('')
            }}
          >
            <Field label="Resolution notes">
              <textarea
                required
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Button type="submit" disabled={d.status === 'Resolved'}>
              Resolve dispute
            </Button>
          </form>
        </Modal>
      )}
    </>
  )
}
