'use client'

import { ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ClientRedirect } from '../../components/auth/RoleGuard'
import { Button, Heading, Panel } from '../../components/shared'
import {
  accommodatedDeadline,
  approvedAccommodation,
} from '../../context/accommodations'
import { newAttempt, serverNow } from '../../context/MockStoreContext'

import { Missing, useExam } from './shared'

export function IntegrityNoticePage() {
  const { exam, base, user, attempt, update, state } = useExam(),
    [ok, set] = useState(false),
    [starting, setStarting] = useState(false),
    [error, setError] = useState(''),
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
        {error && (
          <p className="danger" role="alert">
            {error}
          </p>
        )}
        <Button
          disabled={!ok || !available || !navigator.onLine}
          onClick={() => {
            setStarting(true)
            let canEnter = false
            update((draft) => {
              const current = draft.exams.find(
                (record) => record.id === exam.id,
              )
              const at = serverNow()
              if (!current?.candidates.includes(user!.id)) return
              const existing = draft.attempts.find(
                (record) =>
                  record.exam === current.id && record.user === user!.id,
              )
              if (existing) {
                canEnter = !existing.submitted
                return
              }
              if (
                current.status !== 'Ongoing' ||
                at < new Date(current.date).getTime() ||
                at > new Date(current.close).getTime()
              )
                return

              const attempt = newAttempt(current, user!.id, at, draft.questions)
              const extraMinutes =
                approvedAccommodation(draft, current.id, user!.id)
                  ?.extraMinutes ?? 0
              attempt.accommodationMinutes = extraMinutes
              attempt.end = accommodatedDeadline(current, at, extraMinutes)
              draft.attempts.push(attempt)
              canEnter = true
            })
            if (!canEnter) {
              setError('The examination is no longer available to start.')
              setStarting(false)
              return
            }
            router.replace(base + '/attempt')
          }}
        >
          Start timed examination
        </Button>
      </Panel>
    </>
  )
}
