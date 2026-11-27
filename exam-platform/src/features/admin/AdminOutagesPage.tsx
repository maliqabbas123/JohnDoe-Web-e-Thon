'use client'

import { useState } from 'react'
import {
  Button,
  Field,
  Heading,
  Panel,
  Timeline,
} from '../../components/shared'
import { iso, serverNow, useStore } from '../../context/MockStoreContext'

export function AdminOutagesPage() {
  const { state, update, toast } = useStore(),
    [exam, setExam] = useState(''),
    [cohort, setCohort] = useState(''),
    [minutes, setMinutes] = useState(15)
  const ongoing = state.exams.filter((e) => e.status === 'Ongoing')
  return (
    <>
      <Heading
        title="Outage management"
        subtitle="Record a verified interruption and extend affected sessions."
      />
      <Panel title="Apply a cohort extension">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!cohort.trim() || !exam) return
            update((s) => {
              s.outages.unshift({ cohort, minutes, exam, at: serverNow() })
              const affected = s.exams.find((x) => x.id === exam)!
              affected.close = iso(
                new Date(affected.close).getTime() + minutes * 60000,
              )
              for (const a of s.attempts.filter(
                (a) => a.exam === exam && !a.submitted,
              ))
                a.end += minutes * 60000
              s.audit.unshift({
                at: serverNow(),
                type: 'Outage',
                message: cohort + ' received ' + minutes + ' minutes',
              })
            })
            toast('Extension applied to affected attempts.')
            setCohort('')
          }}
        >
          <div className="two-col">
            <Field label="Ongoing examination">
              <select
                required
                value={exam}
                onChange={(e) => setExam(e.target.value)}
              >
                <option value="">Select examination</option>
                {ongoing.map((e) => (
                  <option value={e.id} key={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Campus or ISP incident">
              <input
                required
                value={cohort}
                onChange={(e) => setCohort(e.target.value)}
                placeholder="e.g. North campus network outage"
              />
            </Field>
            <Field label="Extension (minutes)">
              <input
                type="number"
                min="1"
                max="240"
                required
                value={minutes}
                onChange={(e) => setMinutes(e.target.valueAsNumber)}
              />
            </Field>
          </div>
          <Button type="submit" disabled={!ongoing.length}>
            Apply extension
          </Button>
        </form>
      </Panel>
      <Panel title="Extension history">
        <Timeline
          events={state.outages.map((o) => ({
            type: 'Extension',
            at: o.at,
            message:
              o.cohort +
              ' · ' +
              o.minutes +
              ' minutes · ' +
              state.exams.find((e) => e.id === o.exam)?.title,
          }))}
        />
      </Panel>
    </>
  )
}
