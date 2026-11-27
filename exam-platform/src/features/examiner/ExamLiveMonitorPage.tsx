'use client'

import { useState } from 'react'
import {
  Badge,
  Button,
  Field,
  Panel,
  ServerSyncedTimer,
  SlideOverDrawer,
  Stats,
  Timeline,
} from '../../components/shared'
import { serverNow } from '../../context/MockStoreContext'

import { ExamHeader, Missing, useExam } from './shared'
import { isLive } from '@/lib/api'
import { LiveExamMonitor } from './LiveExamMonitor'

export function ExamLiveMonitorPage() {
  return isLive ? <LiveExamMonitor /> : <DemoExamLiveMonitorPage />
}

function DemoExamLiveMonitorPage() {
  const { exam, attempts, state, update, toast } = useExam(),
    [selected, set] = useState(''),
    [message, setMessage] = useState('')
  if (!exam) return <Missing />
  const a = attempts.find((a) => a.id === selected),
    active = attempts.filter((a) => !a.submitted)
  return (
    <>
      <ExamHeader exam={exam} title="Live examination monitor" />
      <Stats
        items={[
          ['Enrolled', exam.candidates.length],
          ['Active attempts', active.length],
          [
            'Synced submissions',
            attempts.filter((a) => a.submitted && !a.pending).length,
          ],
        ]}
      />
      <div className="two-col wide-left">
        <Panel title="Candidate activity">
          <div className="monitor-grid">
            {exam.candidates.map((uid) => {
              const a = attempts.find((a) => a.user === uid),
                count = Object.values(a?.answers ?? {}).filter(
                  (v) => v.length,
                ).length
              return (
                <article key={uid}>
                  <strong>{state.users.find((u) => u.id === uid)?.name}</strong>
                  <p>
                    <Badge>
                      {a?.submitted
                        ? 'Submitted'
                        : (a?.network ??
                          (a?.pending
                            ? 'Offline'
                            : a
                              ? 'Online'
                              : 'Not started'))}
                    </Badge>
                  </p>
                  <progress max={exam.paper.length || 1} value={count} />
                  <p>
                    {count} / {exam.paper.length} answered
                  </p>
                  {a && !a.submitted && <ServerSyncedTimer end={a.end} />}
                  <div>
                    <Button secondary disabled={!a} onClick={() => set(a!.id)}>
                      Incidents ({a?.incidents.length ?? 0})
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        </Panel>
        <Panel title="Broadcast announcements">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!message.trim()) return
              update((s) =>
                s.messages.unshift({
                  exam: exam.id,
                  body: message.trim(),
                  at: serverNow(),
                }),
              )
              setMessage('')
              toast('Announcement broadcast.')
            }}
          >
            <Field label="Message to candidates">
              <textarea
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </Field>
            <Button type="submit">Send announcement</Button>
          </form>
          <Timeline
            events={state.messages
              .filter((m) => m.exam === exam.id)
              .map((m) => ({ at: m.at, type: 'Broadcast', message: m.body }))}
          />
        </Panel>
      </div>
      {a && (
        <SlideOverDrawer title="Incident timeline" close={() => set('')}>
          <p>{state.users.find((u) => u.id === a.user)?.name}</p>
          <Timeline events={a.incidents} />
        </SlideOverDrawer>
      )}
    </>
  )
}
