'use client'

import { useParams } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Badge, Button, Field, Panel, Timeline } from '../../components/shared'
import { score, serverNow } from '../../context/MockStoreContext'
import { displayAnswer } from '../candidate'

import { ExamHeader, Missing, disputeStates, useExam } from './shared'

export function DisputeDetailPage() {
  const { disputeId } = useParams<{ disputeId: string }>(),
    { exam, attempts, state, update, toast } = useExam(),
    d = state.disputes.find((d) => d.id === disputeId && d.exam === exam?.id),
    a = attempts.find((a) => a.user === d?.user),
    q = (a?.questions ?? state.questions).find((q) => q.id === d?.question),
    [status, setStatus] = useState(d?.status ?? 'Open'),
    [note, setNote] = useState(''),
    [points, setPoints] = useState<number>(),
    item = (a?.paper ?? exam?.paper)?.find((p) => p.id === q?.id)
  if (!d || !exam) return <Missing />
  function save(e: FormEvent) {
    e.preventDefault()
    if (!note.trim() || !d || !exam) return
    update((s) => {
      const w = s.disputes.find((x) => x.id === d.id)!
      const old = w.status
      w.status = status
      w.notes = note.trim()
      let adjustment = ''
      if (a && q && item && points !== undefined && Number.isFinite(points)) {
        const attempt = s.attempts.find((x) => x.id === a.id)!
        const previous =
          attempt.grades[q.id]?.score ??
          score(exam, { ...attempt, paper: [item] }, s.questions)
        attempt.grades[q.id] = { score: points, feedback: note.trim() }
        adjustment = ' · marks ' + previous + ' → ' + points
      }
      const summary =
        old +
        ' → ' +
        status +
        (status === 'Escalated' ? ' to administrator' : '') +
        adjustment +
        ' · ' +
        note.trim()
      w.revisions.push({ at: serverNow(), summary, status })
      s.audit.unshift({ at: serverNow(), type: 'Dispute', message: summary })
    })
    toast('Dispute revision saved.')
    setNote('')
    setPoints(undefined)
  }
  return (
    <>
      <ExamHeader exam={exam} title="Dispute evidence and decision" />
      <div className="two-col wide-left">
        <Panel title={d.type}>
          <p>{d.claim}</p>
          <Badge>{d.status}</Badge>
          {d.evidence && (
            <>
              <h3>Candidate evidence</h3>
              <p className="whitespace-pre-wrap">{d.evidence}</p>
            </>
          )}
          {q && (
            <>
              <h3>Contested question</h3>
              <p>{q.prompt}</p>
              <p>
                <strong>Candidate response</strong> ·{' '}
                {displayAnswer(q, a?.answers[q.id])}
              </p>
              <p>
                <strong>Marking scheme</strong> ·{' '}
                {q.rubric || displayAnswer(q, q.correct)}
              </p>
            </>
          )}
          <h3>Network evidence</h3>
          <Timeline
            events={a?.incidents.filter((i) => i.type === 'Network') ?? []}
          />
        </Panel>
        <Panel title="Decision and audit trail">
          <form onSubmit={save}>
            <Field label="Review status">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {disputeStates.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            {item && a && (
              <Field
                label={'Revised marks (optional, maximum ' + item.marks + ')'}
              >
                <input
                  type="number"
                  min="0"
                  max={item.marks}
                  step=".1"
                  value={points ?? ''}
                  onChange={(e) =>
                    setPoints(
                      e.target.value === ''
                        ? undefined
                        : e.target.valueAsNumber,
                    )
                  }
                />
              </Field>
            )}
            <Field label="Decision notes">
              <textarea
                required
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            <Button type="submit">Record decision</Button>
          </form>
          <Timeline
            events={d.revisions.map((r) => ({
              at: r.at,
              type: 'Revision',
              message: r.summary,
            }))}
          />
        </Panel>
      </div>
    </>
  )
}
