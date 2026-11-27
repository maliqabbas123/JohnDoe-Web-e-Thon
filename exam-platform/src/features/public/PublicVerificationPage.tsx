'use client'

import { RecordHash } from '../../components/shared/RecordHash'

import { useParams } from 'next/navigation'
import { Badge } from '../../components/shared'
import { date, finalScore, useStore } from '../../context/MockStoreContext'

import { Lookup, PublicCard } from './shared'

export function PublicVerificationPage() {
  const { code } = useParams<{ code?: string[] }>(),
    { state, ready } = useStore(),
    attempt = state.attempts.find(
      (a) =>
        a.code === (code?.length === 1 ? code[0].toUpperCase() : undefined) &&
        a.submitted &&
        !a.pending,
    ),
    exam = state.exams.find((e) => e.id === attempt?.exam && e.released)
  const points =
    exam && attempt ? finalScore(exam, attempt, state.questions) : 0
  return (
    <PublicCard
      title="Verify an examination result"
      subtitle="Check a certificate against the public register."
    >
      <Lookup key={code?.join('/')} initial={code?.join('/')} />
      {code && !ready && <p role="status">Checking the public register…</p>}
      {code &&
        ready &&
        (exam && attempt ? (
          <div className="verification-result">
            <Badge>Verified</Badge>
            <h2>{exam.title}</h2>
            <dl>
              <dt>Issued</dt>
              <dd>{date(attempt.submitted!)}</dd>
              <dt>Result</dt>
              <dd>
                {points.toFixed(1)} / {exam.total} ·{' '}
                {points >= exam.total * 0.5 ? 'Passed' : 'Failed'}
              </dd>
              <dt>Authenticity reference</dt>
              <dd>
                <RecordHash
                  value={JSON.stringify([
                    attempt.code,
                    exam.id,
                    exam.title,
                    attempt.submitted,
                    points,
                    exam.total,
                  ])}
                />
              </dd>
            </dl>
          </div>
        ) : (
          <p role="alert" className="danger">
            No published result matches that verification code.
          </p>
        ))}
    </PublicCard>
  )
}
