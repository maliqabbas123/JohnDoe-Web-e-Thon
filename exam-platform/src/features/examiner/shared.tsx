'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  DataTable,
  Field,
  Heading,
  ImportModal,
  Panel,
  Stats,
  Tabs,
  Timeline,
} from '../../components/shared'
import { id, score, serverNow, useStore } from '../../context/MockStoreContext'
import { quotaCounts, variantPapers } from '../../context/papers'
import type { Attempt, Difficulty, Exam, Kind, Question } from '../../types'
import { AnswerInput, displayAnswer } from '../candidate/shared'

const statuses: Exam['status'][] = [
  'Draft',
  'Published',
  'Ongoing',
  'Completed',
]

const kinds: Kind[] = [
  'Single-Answer MCQ',
  'Multiple-Select',
  'Written Response',
]

const difficulties: Difficulty[] = ['Easy', 'Medium', 'Hard']

const ep = (id: string) => '/examiner/exams/' + id

const qp = (id: string) => '/examiner/questions/' + id

const sandbox = (id: string) =>
  '/candidate/exam/' + id + '/attempt?sandbox=true'

const sections = [
  ['Setup', 'setup'],
  ['Blueprint', 'blueprint'],
  ['Live monitor', 'live'],
  ['Results', 'results'],
  ['Reports', 'reports'],
  ['Integrity', 'integrity'],
  ['Fairness', 'fairness'],
  ['Disruptions', 'disruptions'],
  ['Disputes', 'disputes'],
]

function useExam() {
  const { id } = useParams<{ id: string }>(),
    s = useStore()
  const exam = s.state.exams.find((e) => e.id === id && e.owner === s.user?.id)
  return {
    ...s,
    exam,
    attempts: s.state.attempts.filter((a) => a.exam === exam?.id),
    base: ep(id ?? ''),
  }
}

function Missing() {
  return (
    <Panel>
      <Heading title="Record unavailable" />
      <Button to="/examiner">My examinations</Button>
    </Panel>
  )
}

function ExamHeader({
  exam,
  title,
  actions,
}: {
  exam: Exam
  title: string
  actions?: React.ReactNode
}) {
  return (
    <>
      <Heading
        title={title}
        subtitle={exam.title + ' · ' + exam.subject}
        actions={actions}
      />
      <nav className="exam-nav" aria-label="Examination tools">
        {sections.map(([label, path]) => (
          <Link key={path} href={ep(exam.id) + '/' + path}>
            {label}
          </Link>
        ))}
      </nav>
    </>
  )
}

function pending(e: Exam, a: Attempt, qs: Question[]) {
  return (a.paper ?? e.paper).some(
    (p) =>
      (a.questions ?? qs).find((q) => q.id === p.id)?.kind ===
        'Written Response' && a.grades[p.id] === undefined,
  )
}

function validate(q: Question) {
  if (
    !q.prompt.trim() ||
    !q.topic.trim() ||
    !difficulties.includes(q.difficulty) ||
    !kinds.includes(q.kind) ||
    !Number.isFinite(q.marks) ||
    q.marks <= 0
  )
    throw Error(
      'Prompt, topic, supported difficulty/type, and positive marks are required.',
    )
  if (q.kind === 'Written Response') {
    if (!q.rubric.trim()) throw Error('Enter a written grading rubric.')
    return
  }
  if (
    q.options.length < 2 ||
    q.options.some((o) => !o.trim()) ||
    new Set(q.options.map((o) => o.trim().toLowerCase())).size !==
      q.options.length
  )
    throw Error('Enter at least two distinct answer options.')
  if (
    !q.correct.length ||
    q.correct.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= q.options.length,
    ) ||
    new Set(q.correct).size !== q.correct.length ||
    (q.kind === 'Single-Answer MCQ' && q.correct.length !== 1)
  )
    throw Error('Select valid correct answers for this question type.')
}

const blank = (): Question => ({
  id: id(),
  prompt: '',
  topic: '',
  difficulty: 'Medium',
  kind: 'Single-Answer MCQ',
  options: ['', '', '', ''],
  correct: [],
  rubric: '',
  partial: false,
  marks: 5,
})

function QuestionEditor({ original }: { original?: Question }) {
  const [q, set] = useState(original ?? blank),
    [error, setError] = useState(''),
    [answer, setAnswer] = useState<string | number[]>(),
    { update, toast } = useStore(),
    router = useRouter()
  return (
    <>
      <Heading
        title={original ? 'Edit question' : 'Create question'}
        subtitle="Configure an item, its marking scheme, and candidate preview."
      />
      <div className="two-col">
        <Panel title="Question builder">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              try {
                validate(q)
                update((s) => {
                  const i = s.questions.findIndex((x) => x.id === q.id)
                  if (i < 0) s.questions.push(q)
                  else s.questions[i] = q
                })
                toast('Question saved.')
                router.push('/examiner/questions')
              } catch (err) {
                setError((err as Error).message)
              }
            }}
          >
            <Field label="Question prompt">
              <textarea
                required
                value={q.prompt}
                onChange={(e) => set({ ...q, prompt: e.target.value })}
              />
            </Field>
            <div className="two-col">
              <Field label="Topic">
                <input
                  required
                  value={q.topic}
                  onChange={(e) => set({ ...q, topic: e.target.value })}
                />
              </Field>
              <Field label="Difficulty">
                <select
                  value={q.difficulty}
                  onChange={(e) =>
                    set({ ...q, difficulty: e.target.value as Difficulty })
                  }
                >
                  {difficulties.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </Field>
              <Field label="Question type">
                <select
                  value={q.kind}
                  onChange={(e) => {
                    set({ ...q, kind: e.target.value as Kind, correct: [] })
                    setAnswer(undefined)
                  }}
                >
                  {kinds.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </Field>
              <Field label="Default marks">
                <input
                  type="number"
                  min=".5"
                  step=".5"
                  required
                  value={q.marks}
                  onChange={(e) => set({ ...q, marks: e.target.valueAsNumber })}
                />
              </Field>
            </div>
            {q.kind === 'Written Response' ? (
              <Field label="Grading rubric">
                <textarea
                  required
                  value={q.rubric}
                  onChange={(e) => set({ ...q, rubric: e.target.value })}
                />
              </Field>
            ) : (
              <>
                <fieldset>
                  <legend>Options and correct answers</legend>
                  {q.options.map((o, i) => (
                    <div className="option-editor" key={i}>
                      <input
                        aria-label={'Correct option ' + (i + 1)}
                        type={
                          q.kind === 'Single-Answer MCQ' ? 'radio' : 'checkbox'
                        }
                        name="correct"
                        checked={q.correct.includes(i)}
                        onChange={() =>
                          set({
                            ...q,
                            correct:
                              q.kind === 'Single-Answer MCQ'
                                ? [i]
                                : q.correct.includes(i)
                                  ? q.correct.filter((x) => x !== i)
                                  : [...q.correct, i],
                          })
                        }
                      />
                      <input
                        aria-label={'Option ' + (i + 1)}
                        required
                        value={o}
                        onChange={(e) =>
                          set({
                            ...q,
                            options: q.options.map((x, j) =>
                              j === i ? e.target.value : x,
                            ),
                          })
                        }
                      />
                      <Button
                        secondary
                        disabled={q.options.length <= 2}
                        onClick={() =>
                          set({
                            ...q,
                            options: q.options.filter((_, j) => j !== i),
                            correct: q.correct
                              .filter((j) => j !== i)
                              .map((j) => (j > i ? j - 1 : j)),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    secondary
                    onClick={() => set({ ...q, options: [...q.options, ''] })}
                  >
                    Add option
                  </Button>
                </fieldset>
                {q.kind === 'Multiple-Select' && (
                  <Field label="Marking rule">
                    <select
                      value={q.partial ? 'partial' : 'exact'}
                      onChange={(e) =>
                        set({ ...q, partial: e.target.value === 'partial' })
                      }
                    >
                      <option value="exact">Exact match</option>
                      <option value="partial">
                        Partial credit with incorrect-selection penalty
                      </option>
                    </select>
                  </Field>
                )}
              </>
            )}
            {error && (
              <p role="alert" className="danger">
                {error}
              </p>
            )}
            <Button type="submit">Save question</Button>
          </form>
        </Panel>
        <Panel title="Candidate preview">
          <p>{q.prompt || 'Enter a question prompt to preview it.'}</p>
          <AnswerInput
            q={{
              ...q,
              options: q.options.map((o, i) => o || 'Option ' + (i + 1)),
            }}
            answer={answer}
            change={setAnswer}
          />
        </Panel>
      </div>
    </>
  )
}

function Setup({ exam }: { exam: Exam }) {
  const { state, update, toast } = useStore(),
    [draft, set] = useState(exam),
    [qid, setQ] = useState(''),
    [uid, setU] = useState(''),
    [open, show] = useState(false),
    [error, setError] = useState('')
  const total = draft.paper.reduce((s, p) => s + p.marks, 0),
    validDate = new Date(draft.close) > new Date(draft.date),
    checks = [
      ['Availability window is valid', validDate],
      [
        'Question marks match total marks',
        draft.paper.length > 0 &&
          total === draft.total &&
          draft.paper.every((p) => p.marks > 0),
      ],
      ['At least one candidate is enrolled', draft.candidates.length > 0],
      [
        'Title and instructions are present',
        !!draft.title.trim() && !!draft.instructions.trim(),
      ],
    ] as const,
    ready = checks.every(([, valid]) => valid),
    locked = exam.status === 'Ongoing' || exam.status === 'Completed'
  function save(values: Partial<Exam>, message: string) {
    update((s) => {
      const record = s.exams.find((e) => e.id === exam.id)!
      Object.assign(record, values)
      if (values.paper) delete record.variants
      s.audit.unshift({
        at: serverNow(),
        type: 'Exam',
        message: exam.title + ' · ' + message,
      })
    })
    toast(message)
  }
  function savePaper(paper: Exam['paper']) {
    set({ ...draft, paper })
    save({ paper }, 'Paper updated')
  }
  function enroll(ids: string[]) {
    const next = [...new Set([...draft.candidates, ...ids])]
    set({ ...draft, candidates: next })
    save({ candidates: next }, 'Enrollment updated')
  }
  return (
    <>
      <ExamHeader
        exam={exam}
        title="Exam builder studio"
        actions={
          <Button secondary to={sandbox(exam.id)}>
            Launch sandbox preview
          </Button>
        }
      />
      <Panel>
        <Tabs
          labels={[
            'Settings',
            'Paper builder',
            'Candidates',
            'Review & publish',
          ]}
        >
          {(i) =>
            i === 0 ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!validDate) {
                    setError('Closing time must follow opening time.')
                    return
                  }
                  setError('')
                  const {
                    title,
                    subject,
                    instructions,
                    date,
                    close,
                    duration,
                    total,
                    shuffle,
                    shuffleOptions,
                  } = draft
                  save(
                    {
                      title,
                      subject,
                      instructions,
                      date,
                      close,
                      duration,
                      total,
                      shuffle,
                      shuffleOptions,
                    },
                    'Settings saved',
                  )
                }}
              >
                <fieldset disabled={locked}>
                  <div className="two-col">
                    <Field label="Examination title">
                      <input
                        required
                        value={draft.title}
                        onChange={(e) =>
                          set({ ...draft, title: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Subject code">
                      <input
                        required
                        value={draft.subject}
                        onChange={(e) =>
                          set({ ...draft, subject: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Opens">
                      <input
                        type="datetime-local"
                        required
                        value={draft.date}
                        onChange={(e) =>
                          set({ ...draft, date: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Closes">
                      <input
                        type="datetime-local"
                        required
                        value={draft.close}
                        onChange={(e) =>
                          set({ ...draft, close: e.target.value })
                        }
                      />
                    </Field>
                    <Field label="Duration (minutes)">
                      <input
                        type="number"
                        required
                        min="1"
                        value={draft.duration}
                        onChange={(e) =>
                          set({ ...draft, duration: e.target.valueAsNumber })
                        }
                      />
                    </Field>
                    <Field label="Total marks">
                      <input
                        type="number"
                        required
                        min="1"
                        value={draft.total}
                        onChange={(e) =>
                          set({ ...draft, total: e.target.valueAsNumber })
                        }
                      />
                    </Field>
                  </div>
                  <Field label="Instructions">
                    <textarea
                      required
                      value={draft.instructions}
                      onChange={(e) =>
                        set({ ...draft, instructions: e.target.value })
                      }
                    />
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.shuffle}
                      onChange={(e) =>
                        set({ ...draft, shuffle: e.target.checked })
                      }
                    />{' '}
                    Randomize question order
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.shuffleOptions}
                      onChange={(e) =>
                        set({ ...draft, shuffleOptions: e.target.checked })
                      }
                    />{' '}
                    Randomize option order
                  </label>
                  {error && <p role="alert">{error}</p>}
                  <Button type="submit">Save settings</Button>
                </fieldset>
              </form>
            ) : i === 1 ? (
              <>
                <h2>Assigned questions</h2>
                <p>
                  {total} of {draft.total} marks assigned.
                </p>
                {draft.paper.map((p) => (
                  <div className="exam-row" key={p.id}>
                    <div>
                      {state.questions.find((q) => q.id === p.id)?.prompt}
                    </div>
                    <Field label="Marks">
                      <input
                        type="number"
                        min=".5"
                        step=".5"
                        disabled={locked}
                        value={p.marks}
                        onChange={(e) =>
                          set({
                            ...draft,
                            paper: draft.paper.map((x) =>
                              x.id === p.id
                                ? { ...x, marks: e.target.valueAsNumber }
                                : x,
                            ),
                          })
                        }
                      />
                    </Field>
                    <Button
                      secondary
                      disabled={locked}
                      onClick={() =>
                        savePaper(draft.paper.filter((x) => x.id !== p.id))
                      }
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div className="actions">
                  <select
                    aria-label="Question to assign"
                    disabled={locked}
                    value={qid}
                    onChange={(e) => setQ(e.target.value)}
                  >
                    <option value="">Select a bank question</option>
                    {state.questions
                      .filter((q) => !draft.paper.some((p) => p.id === q.id))
                      .map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.prompt}
                        </option>
                      ))}
                  </select>
                  <Button
                    disabled={locked || !qid}
                    onClick={() => {
                      const q = state.questions.find((q) => q.id === qid)!
                      savePaper([...draft.paper, { id: q.id, marks: q.marks }])
                      setQ('')
                    }}
                  >
                    Assign question
                  </Button>
                  <Button
                    secondary
                    disabled={locked || draft.paper.some((p) => !(p.marks > 0))}
                    onClick={() => savePaper(draft.paper)}
                  >
                    Save marks
                  </Button>
                </div>
              </>
            ) : i === 2 ? (
              <>
                <div className="actions">
                  <select
                    aria-label="Candidate to enroll"
                    value={uid}
                    onChange={(e) => setU(e.target.value)}
                  >
                    <option value="">Select candidate</option>
                    {state.users
                      .filter(
                        (u) =>
                          u.role === 'Candidate' &&
                          u.active &&
                          !draft.candidates.includes(u.id),
                      )
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                  </select>
                  <Button
                    disabled={!uid || exam.status === 'Completed'}
                    onClick={() => {
                      enroll([uid])
                      setU('')
                    }}
                  >
                    Enroll candidate
                  </Button>
                  <Button
                    secondary
                    disabled={exam.status === 'Completed'}
                    onClick={() => show(true)}
                  >
                    Import candidates
                  </Button>
                </div>
                <DataTable
                  columns={['Candidate', 'Email', 'Eligibility']}
                  rows={state.users
                    .filter((u) => draft.candidates.includes(u.id))
                    .map((u) => ({
                      key: u.id,
                      search: u.name + ' ' + u.email,
                      cells: [
                        u.name,
                        u.email,
                        <Badge>{u.active ? 'Eligible' : 'Inactive'}</Badge>,
                      ],
                    }))}
                />
              </>
            ) : (
              <>
                <h2>Publication checklist</h2>
                {checks.map(([label, valid]) => (
                  <p key={label}>
                    <Badge>{valid ? 'Verified' : 'Pending'}</Badge> {label}
                  </p>
                ))}
                <p>
                  Current state <Badge>{exam.status}</Badge>
                </p>
                {exam.status !== 'Completed' && (
                  <Button
                    disabled={
                      exam.status === 'Draft' &&
                      (!ready ||
                        JSON.stringify(draft.paper) !==
                          JSON.stringify(exam.paper) ||
                        draft.title !== exam.title ||
                        draft.total !== exam.total ||
                        draft.date !== exam.date ||
                        draft.close !== exam.close ||
                        draft.instructions !== exam.instructions)
                    }
                    onClick={() => {
                      const next = statuses[statuses.indexOf(exam.status) + 1]
                      save(
                        { status: next },
                        'Examination marked ' + next.toLowerCase(),
                      )
                    }}
                  >
                    {exam.status === 'Draft'
                      ? 'Publish examination'
                      : exam.status === 'Published'
                        ? 'Open examination'
                        : 'Complete examination'}
                  </Button>
                )}
              </>
            )
          }
        </Tabs>
      </Panel>
      {open && (
        <ImportModal
          title="Bulk candidate enrollment"
          close={() => show(false)}
          limit={state.policy.importLimit}
          fields="email"
          parse={(r) => {
            const u = state.users.find(
              (u) =>
                u.role === 'Candidate' &&
                u.active &&
                u.email.toLowerCase() ===
                  String(r.email ?? '')
                    .trim()
                    .toLowerCase(),
            )
            if (!u) throw Error('No active candidate matches the email.')
            if (draft.candidates.includes(u.id))
              throw Error('Candidate is already enrolled.')
            return u.id
          }}
          save={(rows) => {
            if (new Set(rows).size !== rows.length)
              throw Error('The file contains duplicate candidates.')
            enroll(rows)
          }}
        />
      )}
    </>
  )
}

function Blueprint({ exam }: { exam: Exam }) {
  const { state, update, toast } = useStore()
  const topics = [...new Set(state.questions.map((q) => q.topic))]
  const [weights, set] = useState(exam.blueprint)
  const [error, setError] = useState('')
  const groups = [
    { title: 'Difficulty quotas', keys: difficulties },
    { title: 'Topic weights', keys: topics },
  ]
  const sum = (keys: string[]) =>
    keys.reduce((n, k) => n + (weights[k] ?? 0), 0)
  const locked = exam.status === 'Ongoing' || exam.status === 'Completed'

  function save(event: FormEvent) {
    event.preventDefault()
    try {
      const papers = variantPapers(exam, state.questions, weights)
      update((s) => {
        const target = s.exams.find((record) => record.id === exam.id)!
        target.blueprint = weights
        target.variants = papers
        s.audit.unshift({
          at: serverNow(),
          type: 'Exam',
          message: 'Balanced variants saved for ' + exam.title,
        })
      })
      setError('')
      toast('Blueprint and variants saved.')
    } catch (err) {
      setError((err as Error).message)
    }
  }
  return (
    <>
      <ExamHeader exam={exam} title="Paper blueprint" />
      <Panel>
        <form onSubmit={save}>
          <div className="two-col">
            {groups.map(({ title, keys }) => (
              <fieldset disabled={locked} key={title}>
                <legend>
                  {title} · {sum(keys)}%
                </legend>
                {keys.map((key) => (
                  <Field key={key} label={key + ' (%)'}>
                    <input
                      type="number"
                      required
                      min="0"
                      max="100"
                      value={weights[key] ?? 0}
                      onChange={(e) =>
                        set({ ...weights, [key]: e.target.valueAsNumber })
                      }
                    />
                  </Field>
                ))}
              </fieldset>
            ))}
          </div>
          <p>
            Each group must total 100%. Variants substitute questions from the
            same topic, difficulty, and question type while keeping the assigned
            marks.
          </p>
          {locked && (
            <p>This examination has started. Its blueprint is locked.</p>
          )}
          {error && (
            <p className="danger" role="alert">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={locked || groups.some(({ keys }) => sum(keys) !== 100)}
          >
            Save blueprint and generate variants
          </Button>
        </form>
      </Panel>
      <Panel title="Assigned paper composition">
        {groups.map(({ title, keys }, index) => {
          const counts = quotaCounts(weights, keys, exam.paper.length)
          return (
            <section key={title}>
              <h3>{title}</h3>
              {keys.map((key) => {
                const n = exam.paper.filter(
                  (p) =>
                    state.questions.find((q) => q.id === p.id)?.[
                      index === 0 ? 'difficulty' : 'topic'
                    ] === key,
                ).length
                return (
                  <div className="metric" key={key}>
                    <span>{key}</span>
                    <progress max={exam.paper.length || 1} value={n} />
                    <span>
                      {n} assigned · {counts[key] ?? 0} target
                    </span>
                  </div>
                )
              })}
            </section>
          )
        })}
      </Panel>
      {exam.variants && (
        <Panel title="Saved variants">
          {Object.entries(exam.variants).map(([variant, paper]) => (
            <details key={variant}>
              <summary>Variant {variant}</summary>
              <ul>
                {paper.map((item) => (
                  <li key={item.id}>
                    {state.questions.find((q) => q.id === item.id)?.prompt} ·{' '}
                    {item.marks} marks
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </Panel>
      )}
    </>
  )
}

function Cohort({ points, total }: { points: number[]; total: number }) {
  const sorted = [...points].sort((a, b) => a - b),
    n = points.length,
    median = n
      ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2
      : 0,
    display = (x: number) => (n ? x.toFixed(1) : '—')
  return (
    <>
      <Stats
        items={[
          ['Mean', display(points.reduce((a, b) => a + b, 0) / (n || 1))],
          ['Median', display(median)],
          ['Highest', display(sorted.at(-1) ?? 0)],
          ['Lowest', display(sorted[0] ?? 0)],
          [
            'Pass rate',
            n
              ? Math.round(
                  (100 * points.filter((x) => x >= total * 0.5).length) / n,
                ) + '%'
              : '—',
          ],
        ]}
      />
      <h2>Score distribution</h2>
      {[0, 20, 40, 60, 80].map((low) => {
        const count = points.filter((p) => {
          const x = Math.min(99.999, (100 * p) / total)
          return x >= low && x < low + 20
        }).length
        return (
          <div className="metric" key={low}>
            <span>
              {low}–{low + 20}%
            </span>
            <progress max={n || 1} value={count} />
            <strong>{count}</strong>
          </div>
        )
      })}
    </>
  )
}

function Grade({ exam, attempt }: { exam: Exam; attempt: Attempt }) {
  const { state, update, toast } = useStore(),
    [grades, set] = useState(attempt.grades)
  return (
    <>
      <ExamHeader exam={exam} title="Manual grading" />
      <div className="two-col wide-left">
        <Panel title={state.users.find((u) => u.id === attempt.user)?.name}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              update((s) => {
                s.attempts.find((a) => a.id === attempt.id)!.grades = grades
                s.audit.unshift({
                  at: serverNow(),
                  type: 'Grading',
                  message: 'Grading updated for ' + attempt.id,
                })
              })
              toast('Grades saved.')
            }}
          >
            {(attempt.paper ?? exam.paper).map((p, i) => {
              const q = (attempt.questions ?? state.questions).find(
                (q) => q.id === p.id,
              )!
              return (
                <fieldset key={p.id}>
                  <legend>
                    Question {i + 1} · {p.marks} marks
                  </legend>
                  <p>{q.prompt}</p>
                  <p>
                    <strong>Response</strong> ·{' '}
                    {displayAnswer(q, attempt.answers[p.id])}
                  </p>
                  {q.kind === 'Written Response' ? (
                    <>
                      <p>{q.rubric}</p>
                      <Field label="Awarded marks">
                        <input
                          required
                          type="number"
                          step=".1"
                          min="0"
                          max={p.marks}
                          value={grades[p.id]?.score ?? ''}
                          onChange={(e) =>
                            set({
                              ...grades,
                              [p.id]: {
                                score: e.target.valueAsNumber,
                                feedback: grades[p.id]?.feedback ?? '',
                              },
                            })
                          }
                        />
                      </Field>
                      <Field label="Feedback">
                        <textarea
                          value={grades[p.id]?.feedback ?? ''}
                          onChange={(e) =>
                            set({
                              ...grades,
                              [p.id]: {
                                score: grades[p.id]?.score ?? 0,
                                feedback: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    </>
                  ) : (
                    <>
                      <p>Correct response · {displayAnswer(q, q.correct)}</p>
                      <Badge>
                        {score(
                          exam,
                          { ...attempt, paper: [p] },
                          state.questions,
                        ).toFixed(1) +
                          ' / ' +
                          p.marks +
                          ' auto-graded'}
                      </Badge>
                    </>
                  )}
                </fieldset>
              )
            })}
            <Button type="submit">Save grades</Button>
          </form>
        </Panel>
        <Panel title="Recorded incident timeline">
          <Timeline events={attempt.incidents} />
        </Panel>
      </div>
    </>
  )
}

const disputeStates = ['Open', 'Under Review', 'Resolved', 'Escalated']

export {
  blank,
  Blueprint,
  Cohort,
  difficulties,
  disputeStates,
  ep,
  ExamHeader,
  Grade,
  kinds,
  Missing,
  pending,
  qp,
  QuestionEditor,
  sandbox,
  Setup,
  statuses,
  useExam,
  validate,
}
