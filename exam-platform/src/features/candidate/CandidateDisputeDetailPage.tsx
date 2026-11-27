'use client'

import { useParams } from 'next/navigation'
import {
  Badge,
  Button,
  Heading,
  Panel,
  Timeline,
} from '../../components/shared'
import { candidateDisputeHistory } from '../../context/disputes'
import { useStore } from '../../context/MockStoreContext'

export function CandidateDisputeDetailPage() {
  const { disputeId } = useParams<{ disputeId: string }>()
  const { state, user } = useStore()
  const dispute = state.disputes.find(
    (record) => record.id === disputeId && record.user === user?.id,
  )
  const back = (
    <Button secondary to="/candidate/disputes">
      My disputes
    </Button>
  )

  if (!dispute) return <Heading title="Dispute unavailable" actions={back} />

  const exam = state.exams.find((record) => record.id === dispute.exam)
  const attempt = state.attempts.find(
    (record) => record.user === user?.id && record.exam === dispute.exam,
  )
  const question = (attempt?.questions ?? state.questions).find(
    (record) => record.id === dispute.question,
  )

  return (
    <>
      <Heading title={dispute.type} subtitle={exam?.title} actions={back} />
      <div className="two-col">
        <Panel title="Your appeal">
          <Badge>{dispute.status}</Badge>
          {question && (
            <p>
              <strong>Question</strong> · {question.prompt}
            </p>
          )}
          <p className="whitespace-pre-wrap">{dispute.claim}</p>
          {dispute.evidence && (
            <>
              <h3>Supporting details</h3>
              <p className="whitespace-pre-wrap">{dispute.evidence}</p>
            </>
          )}
        </Panel>
        <Panel title="Status history">
          <Timeline events={candidateDisputeHistory(dispute)} />
          <h3>
            {dispute.status === 'Resolved' ? 'Final decision' : 'Latest update'}
          </h3>
          <p className="whitespace-pre-wrap">
            {dispute.notes || 'Awaiting a review decision.'}
          </p>
          {exam?.released && attempt?.submitted && !attempt.pending && (
            <Button secondary to={'/candidate/exam/' + exam.id + '/result'}>
              View scorecard
            </Button>
          )}
        </Panel>
      </div>
    </>
  )
}
