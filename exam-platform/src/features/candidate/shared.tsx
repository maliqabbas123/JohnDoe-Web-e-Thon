'use client'

import { useParams } from 'next/navigation'
import { Button, Field, Heading, Panel } from '../../components/shared'
import { useStore } from '../../context/MockStoreContext'
import type { Answer, Question } from '../../types'

const defaults = { size: 'M', contrast: false, split: true }

const path = (id: string) => '/candidate/exam/' + id

function useExam(preview = false) {
  const { id } = useParams<{ id: string }>(),
    store = useStore(),
    sandbox = preview && store.user?.role === 'Examiner',
    exam = store.state.exams.find(
      (e) =>
        e.id === id &&
        (sandbox
          ? e.owner === store.user?.id
          : e.candidates.includes(store.user?.id ?? '')),
    ),
    attempt = store.state.attempts.find(
      (a) => a.exam === id && a.user === store.user?.id,
    )
  return {
    ...store,
    exam: exam && attempt?.paper ? { ...exam, paper: attempt.paper } : exam,
    attempt,
    sandbox,
    base: path(id ?? ''),
  }
}

function Missing() {
  return (
    <Panel>
      <Heading
        title="Examination unavailable"
        subtitle="This examination is unavailable for your account."
      />
      <Button to="/candidate">My workspace</Button>
    </Panel>
  )
}

function Preferences({
  value,
  change,
}: {
  value: typeof defaults
  change: (value: typeof defaults) => void
}) {
  return (
    <>
      <Field label="Text size">
        <select
          value={value.size}
          onChange={(e) => change({ ...value, size: e.target.value })}
        >
          {['S', 'M', 'L', 'XL'].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={value.contrast}
          onChange={(e) => change({ ...value, contrast: e.target.checked })}
        />{' '}
        High contrast
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={value.split}
          onChange={(e) => change({ ...value, split: e.target.checked })}
        />{' '}
        Side-by-side navigation
      </label>
    </>
  )
}

function seededOrder<T>(items: T[], seed: string) {
  let hash = 2166136261
  for (const c of seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619)
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    hash = (Math.imul(hash, 1664525) + 1013904223) >>> 0
    const j = hash % (i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function AnswerInput({
  q,
  answer,
  change,
  order,
}: {
  q: Question
  answer?: Answer
  change: (value: Answer) => void
  order?: number[]
}) {
  const selected = Array.isArray(answer) ? answer : [],
    written = typeof answer === 'string' ? answer : ''
  if (q.kind === 'Written Response')
    return (
      <>
        <Field label="Written response">
          <textarea
            rows={9}
            value={written}
            onChange={(e) => change(e.target.value)}
            placeholder="Write your response here…"
          />
        </Field>
        <small>
          {written.trim() ? written.trim().split(/\s+/).length : 0} words ·{' '}
          {written.length} characters
        </small>
      </>
    )
  return (
    <div className="answer-options">
      {(order ?? q.options.map((_, i) => i)).map((index) => (
        <label
          className={'answer ' + (selected.includes(index) ? 'selected' : '')}
          key={index}
        >
          <input
            type={q.kind === 'Single-Answer MCQ' ? 'radio' : 'checkbox'}
            name={q.id}
            checked={selected.includes(index)}
            onChange={() =>
              change(
                q.kind === 'Single-Answer MCQ'
                  ? [index]
                  : selected.includes(index)
                    ? selected.filter((x) => x !== index)
                    : [...selected, index],
              )
            }
          />
          {q.options[index]}
        </label>
      ))}
    </div>
  )
}

const answered = (a: Answer | undefined) =>
  typeof a === 'string' ? !!a.trim() : !!a?.length

function displayAnswer(q: Question, a?: Answer) {
  return Array.isArray(a)
    ? a
        .map((i) => q.options[i])
        .filter(Boolean)
        .join(', ') || 'No response'
    : a || 'No response'
}

export {
  AnswerInput,
  Missing,
  Preferences,
  answered,
  defaults,
  displayAnswer,
  path,
  seededOrder,
  useExam,
}
