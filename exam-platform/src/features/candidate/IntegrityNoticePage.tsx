'use client'

import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ClientRedirect } from '../../components/auth/RoleGuard'
import { Button, Heading, Panel } from '../../components/shared'
import { newAttempt, serverNow } from '../../context/MockStoreContext'

import { Missing, useExam } from './shared'

export function IntegrityNoticePage() {
  const { exam, base, user, attempt, update, state } = useExam(),
    [ok, set] = useState(false),
    [starting, setStarting] = useState(false),
    router = useRouter()
  if (!exam) return <Missing />
  if (starting) return <p role="status">Opening your timed examination…</p>
  if (attempt)
    return (
      <ClientRedirect
        href={base + (attempt.submitted ? '/submitted' : '/recover')}
      />
    )
  const available =
    exam.status === 'Ongoing' &&
    serverNow() >= new Date(exam.date).getTime() &&
    serverNow() <= new Date(exam.close).getTime()
  return (
    <>
      <Heading title="Integrity and privacy notice" subtitle={exam.title} />
      <Panel>
        <p>
          <ShieldCheck size={24} />
        </p>
        <p>
          {state.policy.incidents
            ? 'The workspace records window focus changes and paste events for examiner review.'
            : 'Focus and paste telemetry are off for this workspace.'}{' '}
          Cameras and microphones are never activated.
        </p>
        <p>
          Responses are saved on this device as you work. Your countdown
          continues during a connection interruption.
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={ok}
            onChange={(e) => set(e.target.checked)}
          />{' '}
          I have read and acknowledge the integrity notice.
        </label>
        <Button
          disabled={!ok || !available || !navigator.onLine}
          onClick={() => {
            setStarting(true)
            update((s) => {
              if (
                !s.attempts.some(
                  (a) => a.exam === exam.id && a.user === user!.id,
                )
              ) {
                const a = newAttempt(exam, user!.id, serverNow(), s.questions)
                a.end = Math.min(a.end, new Date(exam.close).getTime())
                s.attempts.push(a)
              }
            })
            router.replace(base + '/attempt')
          }}
        >
          Start timed examination
        </Button>
      </Panel>
    </>
  )
}
