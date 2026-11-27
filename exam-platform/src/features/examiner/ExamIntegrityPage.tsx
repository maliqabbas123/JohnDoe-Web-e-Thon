'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  DataTable,
  Field,
  Panel,
  SlideOverDrawer,
  Timeline,
} from '../../components/shared'
import { serverNow } from '../../context/MockStoreContext'

import { ExamHeader, Missing, useExam } from './shared'

export function ExamIntegrityPage() {
  const { exam, attempts, state, update, toast } = useExam(),
    [selected, set] = useState('')
  if (!exam) return <Missing />
  const a = attempts.find((a) => a.id === selected)
  return (
    <>
      <ExamHeader exam={exam} title="Integrity review" />
      <Panel>
        <p>
          Recorded indicators support human review. Incident threshold:{' '}
          {state.policy.threshold} events.
        </p>
        <DataTable
          columns={[
            'Candidate',
            'Focus losses',
            'Paste events',
            'Rapid responses',
            'Review',
            'Timeline',
          ]}
          filters={{ Status: ['Unreviewed', 'Under Review', 'Reviewed'] }}
          rows={attempts.map((a) => {
            const name = state.users.find((u) => u.id === a.user)?.name ?? '',
              of = (type: string) =>
                a.incidents.filter((i) => i.type === type).length
            return {
              key: a.id,
              search: name,
              filters: { Status: a.review },
              cells: [
                name,
                of('Focus'),
                of('Paste'),
                of('Pace'),
                <Badge>{a.review}</Badge>,
                <Button secondary onClick={() => set(a.id)}>
                  Review events
                </Button>,
              ],
            }
          })}
        />
      </Panel>
      {a && (
        <SlideOverDrawer title="Human review" close={() => set('')}>
          <Timeline events={a.incidents} />
          <Field label="Review status">
            <select
              value={a.review}
              onChange={(e) => {
                const value = e.target.value
                update((s) => {
                  s.attempts.find((x) => x.id === a.id)!.review = value
                  s.audit.unshift({
                    at: serverNow(),
                    type: 'Integrity',
                    message: 'Review status updated for ' + a.id,
                  })
                })
                toast('Review status saved.')
              }}
            >
              {['Unreviewed', 'Under Review', 'Reviewed'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </Field>
        </SlideOverDrawer>
      )}
    </>
  )
}
