'use client'

import { useEffect, useState } from 'react'
import {
  Button,
  Heading,
  NetworkStatusPill,
  Panel,
  Stats,
} from '../../components/shared'
import { date, serverNow } from '../../context/MockStoreContext'

import { Missing, useExam } from './shared'

export function ExamLobbyPage() {
  const { exam, base, attempt } = useExam(),
    [online, set] = useState(navigator.onLine)
  useEffect(() => {
    const check = () => set(navigator.onLine)
    addEventListener('online', check)
    addEventListener('offline', check)
    return () => {
      removeEventListener('online', check)
      removeEventListener('offline', check)
    }
  }, [])
  if (!exam) return <Missing />
  const available =
    exam.status === 'Ongoing' &&
    serverNow() >= new Date(exam.date).getTime() &&
    serverNow() <= new Date(exam.close).getTime()
  return (
    <>
      <Heading
        title={exam.title}
        subtitle={exam.subject + ' · Examination lobby'}
      />
      <Stats
        items={[
          ['Duration', exam.duration + ' min'],
          ['Total marks', exam.total],
          ['Questions', exam.paper.length],
        ]}
      />
      <Panel title="Instructions">
        <p>{exam.instructions}</p>
        <p>
          Each question shows its mark value. Single-answer questions require
          the correct option. Multiple-select questions follow the specified
          exact-match or partial-credit marking rule. Written responses are
          graded against a rubric.
        </p>
        <p>
          Available {date(exam.date)} until {date(exam.close)}.
        </p>
        <p>
          <NetworkStatusPill
            status={online ? 'Online' : 'Offline'}
            pending={!online}
          />
        </p>
        <Button
          disabled={!online || !available}
          to={base + (attempt ? '/recover' : '/integrity-notice')}
        >
          Proceed to exam
        </Button>
      </Panel>
    </>
  )
}
