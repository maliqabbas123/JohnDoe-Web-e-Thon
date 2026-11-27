'use client'

import { useState } from 'react'
import { Button, Field, Heading, Panel } from '../../components/shared'
import { serverNow, useStore } from '../../context/MockStoreContext'

export function AdminSettingsPage() {
  const { state, update, toast } = useStore(),
    [p, set] = useState(state.policy)
  const numbers = [
    ['timeout', 'Session timeout (minutes)', 1, 1440],
    ['password', 'Minimum password length', 8, 128],
    ['importLimit', 'Maximum import rows', 1, 10000],
    ['threshold', 'Incident review threshold', 1, 100],
  ] as const
  return (
    <>
      <Heading
        title="Platform settings"
        subtitle="Configure session, password, import, and incident policies."
      />
      <Panel>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            update((s) => {
              s.policy = p
              s.audit.unshift({
                at: serverNow(),
                type: 'Policy',
                message: 'Platform settings updated',
              })
            })
            toast('Platform settings saved.')
          }}
        >
          <div className="two-col">
            {numbers.map(([key, label, min, max]) => (
              <Field key={key} label={label}>
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  value={p[key]}
                  onChange={(e) => set({ ...p, [key]: e.target.valueAsNumber })}
                />
              </Field>
            ))}
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={p.incidents}
              onChange={(e) => set({ ...p, incidents: e.target.checked })}
            />{' '}
            Record focus and paste incidents
          </label>
          <Button type="submit">Save platform settings</Button>
        </form>
      </Panel>
    </>
  )
}
