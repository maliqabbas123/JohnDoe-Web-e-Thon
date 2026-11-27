'use client'

import { useParams } from 'next/navigation'
import { useState } from 'react'
import {
  Badge,
  Button,
  Field,
  Heading,
  Panel,
  Timeline,
} from '../../components/shared'
import { isEscalatedDispute } from '../../context/disputes'
import { serverNow, useStore } from '../../context/MockStoreContext'
import { displayAnswer } from '../candidate/shared'

export function AdminDisputeDetailPage() {
  const { disputeId } = useParams<{ disputeId: string }>()
  const { state, update, toast } = useStore()
  const [notes, setNotes] = useState('')
  const dispute = state.disputes.find(
    (record) => record.id === disputeId && isEscalatedDispute(record),
  )
  const back = (
    <Button secondary to="/admin/disputes">
      Escalated disputes
    </Button>
  )
  if (!dispute) return <Heading title="Dispute unavailable" actions={back} />

  const exam = state.exams.find((record) => record.id === dispute.exam)
  const candidate = state.users.find((record) => record.id === dispute.user)
  const attempt = state.attempts.find(
    (record) => record.exam === dispute.exam && record.user === dispute.user,
  )
  const question = (attempt?.questions ?? state.questions).find(
    (record) => record.id === dispute.question,
  )

  return (
    <>
      <Heading
        title="Dispute arbitration"
        subtitle={exam?.title}
        actions={back}
      />
      <div className="two-col wide-left">
        <Panel title={dispute.type}>
          <Badge>{dispute.status}</Badge>
          <p>
            <strong>Candidate</strong> · {candidate?.name ?? 'Unknown'}
          </p>
          <p className="whitespace-pre-wrap">{dispute.claim}</p>
          {dispute.evidence && (
            <>
              <h3>Candidate evidence</h3>
              <p className="whitespace-pre-wrap">{dispute.evidence}</p>
            </>
          )}
          {question && (
            <>
              <h3>Question and response</h3>
              <p>{question.prompt}</p>
              <p className="whitespace-pre-wrap">
                {displayAnswer(question, attempt?.answers[question.id])}
              </p>
              <p>
                <strong>Marking scheme</strong> ·{' '}
                {question.rubric || displayAnswer(question, question.correct)}
              </p>
              {attempt?.grades[question.id] && (
                <p>
                  <strong>Recorded feedback</strong> ·{' '}
                  {attempt.grades[question.id].feedback}
                </p>
              )}
            </>
          )}
          <h3>Connection events</h3>
          <Timeline
            events={
              attempt?.incidents.filter((event) => event.type === 'Network') ??
              []
            }
          />
        </Panel>
        <Panel title="Decisions and audit trail">
          <Timeline
            events={dispute.revisions.map((revision) => ({
              at: revision.at,
              type: revision.status ?? 'Revision',
              message: revision.summary,
            }))}
          />
          {dispute.notes && (
            <p className="whitespace-pre-wrap">{dispute.notes}</p>
          )}
          {dispute.status === 'Escalated' && (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const decision = notes.trim()
                if (!decision) return
                let saved = false
                update((draft) => {
                  const record = draft.disputes.find(
                    (entry) => entry.id === disputeId,
                  )
                  if (record?.status !== 'Escalated') return
                  const at = serverNow()
                  record.status = 'Resolved'
                  record.notes = decision
                  record.revisions.push({
                    at,
                    status: 'Resolved',
                    summary: 'Resolved by administrator: ' + decision,
                  })
                  draft.audit.unshift({
                    at,
                    type: 'Dispute',
                    message: 'Administrator resolved dispute ' + disputeId,
                  })
                  saved = true
                })
                toast(
                  saved
                    ? 'Arbitration decision saved.'
                    : 'The dispute status changed.',
                )
                if (saved) setNotes('')
              }}
            >
              <Field label="Decision to share with the candidate">
                <textarea
                  required
                  maxLength={2000}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Field>
              <Button type="submit" disabled={!notes.trim()}>
                Resolve dispute
              </Button>
            </form>
          )}
        </Panel>
      </div>
    </>
  )
}
