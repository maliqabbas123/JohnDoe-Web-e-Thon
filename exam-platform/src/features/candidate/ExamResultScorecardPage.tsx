'use client'

import { Printer } from 'lucide-react'
import { useState } from 'react'
import {
  Badge,
  Button,
  Field,
  Heading,
  Modal,
  Panel,
  Stats,
  VerifiableQRCode,
} from '../../components/shared'
import { date, finalScore, id, serverNow } from '../../context/MockStoreContext'

import { Missing, useExam } from './shared'

export function ExamResultScorecardPage() {
  const { state, exam, attempt, base, update, toast, user } = useExam(),
    [open, set] = useState(false),
    [question, setQuestion] = useState(''),
    [type, setType] = useState('Grading appeal'),
    [claim, setClaim] = useState('')
  if (!exam?.released || !attempt?.submitted || attempt.pending)
    return <Missing />
  const result = finalScore(exam, attempt, state.questions),
    percent = (100 * result) / exam.total
  return (
    <>
      <Heading
        title="Examination scorecard"
        subtitle={exam.title}
        actions={
          <Button onClick={() => print()}>
            <Printer size={17} /> Print / save PDF
          </Button>
        }
      />
      <Panel>
        <div className="scorecard">
          <div>
            <Badge>{percent >= 50 ? 'Passed' : 'Failed'}</Badge>
            <h2>{user!.name}</h2>
            <Stats
              items={[
                ['Score', result.toFixed(1) + ' / ' + exam.total],
                ['Percentage', percent.toFixed(1) + '%'],
              ]}
            />
            <p>Submitted {date(attempt.submitted)}</p>
          </div>
          <VerifiableQRCode code={attempt.code} />
        </div>
        <div className="actions no-print">
          <Button to={base + '/review'}>Review answers</Button>
          <Button secondary onClick={() => set(true)}>
            Raise dispute
          </Button>
        </div>
      </Panel>
      {open && (
        <Modal title="Raise a dispute" close={() => set(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!claim.trim()) return
              update((s) =>
                s.disputes.unshift({
                  id: id(),
                  exam: exam.id,
                  user: user!.id,
                  question,
                  type,
                  claim: claim.trim(),
                  status: 'Open',
                  notes: '',
                  revisions: [
                    { at: serverNow(), summary: 'Submitted by candidate' },
                  ],
                }),
              )
              set(false)
              setClaim('')
              toast('Dispute submitted.')
            }}
          >
            <Field label="Dispute type">
              <select value={type} onChange={(e) => setType(e.target.value)}>
                {[
                  'Grading appeal',
                  'Contested question',
                  'Technical incident',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Question">
              <select
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              >
                <option value="">Overall examination</option>
                {exam.paper.map((p, i) => (
                  <option key={p.id} value={p.id}>
                    Question {i + 1}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Describe your concern">
              <textarea
                required
                value={claim}
                onChange={(e) => setClaim(e.target.value)}
              />
            </Field>
            <Button type="submit">Submit dispute</Button>
          </form>
        </Modal>
      )}
    </>
  )
}
