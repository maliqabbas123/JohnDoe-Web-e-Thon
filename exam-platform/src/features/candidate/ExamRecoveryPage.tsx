'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ClientRedirect } from '../../components/auth/RoleGuard'
import {
  Button,
  Heading,
  NetworkStatusPill,
  Panel,
  ServerSyncedTimer,
} from '../../components/shared'
import { serverNow } from '../../context/MockStoreContext'

import { Missing, answered, useExam } from './shared'

export function ExamRecoveryPage() {
  const { exam, attempt, base, update } = useExam(),
    [online, set] = useState(navigator.onLine),
    [ready, markReady] = useState(false),
    router = useRouter()
  useEffect(() => {
    const check = () => {
      set(navigator.onLine)
      markReady(false)
    }
    addEventListener('online', check)
    addEventListener('offline', check)
    return () => {
      removeEventListener('online', check)
      removeEventListener('offline', check)
    }
  }, [])
  if (!exam || !attempt) return <Missing />
  if (attempt.submitted && !attempt.pending)
    return <ClientRedirect href={base + '/submitted'} />
  return (
    <>
      <Heading title="Recover your examination" subtitle={exam.title} />
      <Panel title="Local response cache">
        <p>
          {Object.values(attempt.answers).filter(answered).length} answered
          questions are available on this device.
        </p>
        <p>
          <NetworkStatusPill
            status={online ? 'Online' : 'Offline'}
            pending={attempt.pending}
          />
        </p>
        <p>
          Clock reconciliation:{' '}
          {ready
            ? 'Complete'
            : online
              ? 'Ready to reconcile'
              : 'Waiting for a connection'}
        </p>
        <ServerSyncedTimer end={attempt.end} />
        <div className="actions">
          <Button
            disabled={!online}
            onClick={() => {
              if (!ready) {
                update((s) => {
                  const a = s.attempts.find((a) => a.id === attempt.id)!
                  a.pending = false
                  if (!a.submitted && serverNow() >= a.end) a.submitted = a.end
                  a.incidents.push({
                    at: serverNow(),
                    type: 'Network',
                    message: 'Attempt recovered and synchronized',
                  })
                })
                markReady(true)
              } else
                router.push(
                  base + (attempt.submitted ? '/submitted' : '/attempt'),
                )
            }}
          >
            {ready ? 'Resume synced attempt' : 'Reconcile clock and sync'}
          </Button>
          {!attempt.submitted && (
            <Button secondary to={base + '/attempt'}>
              Continue with cached answers
            </Button>
          )}
        </div>
      </Panel>
    </>
  )
}
