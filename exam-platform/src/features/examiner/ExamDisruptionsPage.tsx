'use client'

import { useState } from 'react'
import {
  Button,
  DataTable,
  Field,
  Panel,
  SlideOverDrawer,
  Timeline,
} from '../../components/shared'
import { serverNow } from '../../context/MockStoreContext'

import { ExamHeader, Missing, useExam } from './shared'

export function ExamDisruptionsPage() {
  const { exam, attempts, state, update, toast } = useExam(),
    [selected, set] = useState(''),
    [minutes, setMinutes] = useState(10)
  if (!exam) return <Missing />
  const a = attempts.find((x) => x.id === selected),
    affected = attempts.filter((a) =>
      a.incidents.some((i) => i.type === 'Network'),
    )
  return (
    <>
      <ExamHeader exam={exam} title="Disruption and recovery" />
      <Panel title="Candidates with recorded connection events">
        <DataTable
          columns={['Candidate', 'Network events', 'Grace granted', 'Action']}
          rows={affected.map((a) => {
            const name = state.users.find((u) => u.id === a.user)?.name ?? ''
            return {
              key: a.id,
              search: name,
              cells: [
                name,
                a.incidents.filter((i) => i.type === 'Network').length,
                a.grace + ' min',
                <Button secondary onClick={() => set(a.id)}>
                  Review disruption
                </Button>,
              ],
            }
          })}
        />
      </Panel>
      {a && (
        <SlideOverDrawer title="Recovery window" close={() => set('')}>
          <Timeline events={a.incidents.filter((i) => i.type === 'Network')} />
          <form
            onSubmit={(e) => {
              e.preventDefault()
              update((s) => {
                const t = s.attempts.find((x) => x.id === a.id)!
                t.grace += minutes
                t.end = Math.max(t.end, serverNow()) + minutes * 60000
                t.incidents.push({
                  at: serverNow(),
                  type: 'Grace',
                  message: minutes + ' minutes approved by examiner',
                })
              })
              toast('Grace window approved.')
              set('')
            }}
          >
            <Field label="Grace period in minutes">
              <input
                type="number"
                required
                min="1"
                max="120"
                value={minutes}
                onChange={(e) => setMinutes(e.target.valueAsNumber)}
              />
            </Field>
            <Button type="submit" disabled={!!a.submitted}>
              Approve grace period
            </Button>
          </form>
        </SlideOverDrawer>
      )}
    </>
  )
}
