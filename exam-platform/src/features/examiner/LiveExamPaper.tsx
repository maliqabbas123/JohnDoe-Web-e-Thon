'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, Field, Panel } from '@/components/shared'
import { api } from '@/lib/api'
import {
  examDifficultyLabels,
  examErrorMessage,
  type ExamBankQuestion,
  type ExamDetail,
  type ExamDifficulty,
  type ExamDifficultyRule,
  type ExamPoolRow,
} from './examApi'

interface PoolDraft {
  questionId: string
  marks: string
  title?: string
  difficulty: ExamDifficulty
  archived: boolean
}

function poolDraft(
  questions: ExamPoolRow[],
  prior: PoolDraft[] = [],
): PoolDraft[] {
  const titles = new Map(
    prior.map((question) => [question.questionId, question.title]),
  )
  return questions.map(({ questionId, marks, question }) => ({
    questionId,
    marks: String(marks ?? ''),
    title: titles.get(questionId),
    difficulty: question.difficulty,
    archived: question.isArchived,
  }))
}

const bankPageSize = 15

function BankPicker({
  disabled,
  rows,
  add,
  onTitles,
}: {
  disabled: boolean
  rows: PoolDraft[]
  add: (question: ExamBankQuestion) => void
  onTitles: (questions: ExamBankQuestion[]) => void
}) {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{
    questions: ExamBankQuestion[]
    total: number
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(bankPageSize),
    })
    if (query) params.set('q', query)
    setResult(null)
    setError('')
    api<ExamBankQuestion[]>('/questions?' + params, {
      signal: controller.signal,
    })
      .then(({ data, meta }) => {
        if (controller.signal.aborted) return
        setResult({
          questions: data,
          total: typeof meta?.total === 'number' ? meta.total : data.length,
        })
        onTitles(data)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(examErrorMessage(error))
      })
    return () => controller.abort()
  }, [onTitles, page, query, refresh])

  return (
    <>
      <form
        className="table-tools"
        onSubmit={(event) => {
          event.preventDefault()
          setQuery(input.trim())
          setPage(1)
        }}
      >
        <label className="search">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-label="Search active bank questions"
            placeholder="Search active bank questions…"
            maxLength={100}
          />
        </label>
        <Button secondary type="submit">
          Search
        </Button>
      </form>
      {error ? (
        <div className="actions">
          <p className="danger" role="alert">
            {error}
          </p>
          <Button secondary onClick={() => setRefresh(refresh + 1)}>
            Retry
          </Button>
        </div>
      ) : result ? (
        <>
          {!result.questions.length && (
            <p>
              No matching active questions.{' '}
              <Link href="/examiner/questions">Open the question bank</Link>.
            </p>
          )}
          {result.questions.map((question) => {
            const added = rows.some((row) => row.questionId === question.id)
            return (
              <div className="exam-row" key={question.id}>
                <div>
                  <strong>{question.text}</strong>
                  <p>
                    {examDifficultyLabels[question.difficulty]} ·{' '}
                    {question.defaultMarks} marks
                  </p>
                </div>
                <Button
                  secondary
                  disabled={disabled || added || rows.length >= 500}
                  onClick={() => add(question)}
                >
                  {added ? 'Added' : 'Add'}
                </Button>
              </div>
            )
          })}
          {result.total > bankPageSize && (
            <div className="pagination">
              <span>{result.total} matching questions</span>
              <div className="actions">
                <Button
                  secondary
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {Math.ceil(result.total / bankPageSize)}
                </span>
                <Button
                  secondary
                  disabled={page * bankPageSize >= result.total}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p role="status">Loading bank questions…</p>
      )}
    </>
  )
}

export function LiveExamPaper({
  exam,
  disabled,
  onDirtyChange,
  save,
}: {
  exam: ExamDetail
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
  save: (
    rows: { questionId: string; marks?: number }[],
  ) => Promise<ExamPoolRow[] | undefined>
}) {
  const [saved, setSaved] = useState(() => poolDraft(exam.questions))
  const [rows, setRows] = useState(saved)
  const [titles, setTitles] = useState<Record<string, string>>({})
  const [bankOpen, setBankOpen] = useState(false)
  const balanced = exam.selectionMode === 'BALANCED'
  const dirty =
    rows.length !== saved.length ||
    rows.some(
      (row, index) =>
        row.questionId !== saved[index]?.questionId ||
        (!balanced && row.marks !== saved[index]?.marks),
    )

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const rememberTitles = useCallback((questions: ExamBankQuestion[]) => {
    setTitles((current) => ({
      ...current,
      ...Object.fromEntries(
        questions.map((question) => [question.id, question.text]),
      ),
    }))
  }, [])

  function move(index: number, offset: number) {
    setRows((current) => {
      const next = [...current]
      const moved = next[index]
      next[index] = next[index + offset]
      next[index + offset] = moved
      return next
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = rows.map(({ questionId, marks }) =>
      balanced ? { questionId } : { questionId, marks: Number(marks) },
    )
    const result = await save(payload)
    if (result) {
      const next = poolDraft(result, rows)
      setSaved(next)
      setRows(next)
      onDirtyChange(false)
    }
  }

  return (
    <Panel title={balanced ? 'Question pool' : 'Fixed paper'}>
      <form onSubmit={submit}>
        <p>
          {rows.length} {rows.length === 1 ? 'question' : 'questions'} selected
        </p>
        {!rows.length && <p>No questions selected.</p>}
        {rows.map((row, index) => (
          <div className="exam-row" key={row.questionId}>
            <div>
              <strong>
                {index + 1}.{' '}
                {titles[row.questionId] ??
                  row.title ??
                  examDifficultyLabels[row.difficulty] + ' question'}
              </strong>
              <p>
                {examDifficultyLabels[row.difficulty]} ·{' '}
                <Link
                  href={
                    '/examiner/questions/' +
                    encodeURIComponent(row.questionId) +
                    '/edit'
                  }
                >
                  View bank question
                </Link>{' '}
                {row.archived && <Badge>Archived</Badge>}
              </p>
            </div>
            {!balanced && (
              <Field label={'Marks for question ' + (index + 1)}>
                <input
                  type="number"
                  min="0.01"
                  max="99999.99"
                  step="0.01"
                  required
                  value={row.marks}
                  disabled={disabled}
                  onChange={(event) => {
                    const marks = event.target.value
                    setRows((current) =>
                      current.map((entry) =>
                        entry.questionId === row.questionId
                          ? { ...entry, marks }
                          : entry,
                      ),
                    )
                  }}
                />
              </Field>
            )}
            <div className="actions">
              {!balanced && (
                <>
                  <button
                    className="icon"
                    type="button"
                    aria-label={'Move question ' + (index + 1) + ' up'}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="icon"
                    type="button"
                    aria-label={'Move question ' + (index + 1) + ' down'}
                    disabled={disabled || index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
              <Button
                secondary
                disabled={disabled}
                onClick={() =>
                  setRows((current) =>
                    current.filter(
                      (entry) => entry.questionId !== row.questionId,
                    ),
                  )
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div className="pagination">
          <div className="actions">
            <Button type="submit" disabled={disabled || !dirty}>
              Save {balanced ? 'question pool' : 'paper'}
            </Button>
            {dirty && (
              <Button
                secondary
                disabled={disabled}
                onClick={() => setRows(saved)}
              >
                Discard changes
              </Button>
            )}
            <Button
              secondary
              disabled={disabled}
              onClick={() => setBankOpen(!bankOpen)}
            >
              {bankOpen ? 'Close question picker' : 'Add bank questions'}
            </Button>
          </div>
        </div>
      </form>
      {bankOpen && (
        <BankPicker
          disabled={disabled}
          rows={rows}
          onTitles={rememberTitles}
          add={(question) =>
            setRows((current) => [
              ...current,
              {
                questionId: question.id,
                marks: String(question.defaultMarks),
                title: question.text,
                difficulty: question.difficulty,
                archived: false,
              },
            ])
          }
        />
      )}
    </Panel>
  )
}

const levels = Object.keys(examDifficultyLabels) as ExamDifficulty[]

function rulesDraft(rules: ExamDifficultyRule[]) {
  return levels.map((difficulty) => {
    const rule = rules.find((value) => value.difficulty === difficulty)
    return {
      difficulty,
      percent: String(rule?.percent ?? 0),
      marksEach: String(rule?.marksEach ?? 1),
    }
  })
}

export function LiveExamDifficultyRules({
  exam,
  disabled,
  onDirtyChange,
  save,
}: {
  exam: ExamDetail
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
  save: (payload: {
    questionCount: number
    rules: ExamDifficultyRule[]
  }) => Promise<
    Pick<ExamDetail, 'questionCount' | 'difficultyRules'> | undefined
  >
}) {
  const [savedRules, setSavedRules] = useState(() =>
    rulesDraft(exam.difficultyRules),
  )
  const [rules, setRules] = useState(savedRules)
  const [savedCount, setSavedCount] = useState(String(exam.questionCount ?? ''))
  const [count, setCount] = useState(savedCount)
  const dirty =
    count !== savedCount ||
    rules.some(
      (rule, index) =>
        rule.percent !== savedRules[index].percent ||
        rule.marksEach !== savedRules[index].marksEach,
    )
  const percentage = rules.reduce(
    (total, current) => total + Number(current.percent),
    0,
  )

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = await save({
      questionCount: Number(count),
      rules: rules.map((rule) => ({
        difficulty: rule.difficulty,
        percent: Number(rule.percent),
        marksEach: Number(rule.marksEach),
      })),
    })
    if (result) {
      const nextRules = rulesDraft(result.difficultyRules)
      const nextCount = String(result.questionCount ?? '')
      setSavedRules(nextRules)
      setRules(nextRules)
      setSavedCount(nextCount)
      setCount(nextCount)
      onDirtyChange(false)
    }
  }

  return (
    <Panel title="Balanced-paper rules">
      <form onSubmit={submit}>
        <fieldset disabled={disabled}>
          <Field label="Questions per paper">
            <input
              type="number"
              min={1}
              max={500}
              value={count}
              required
              onChange={(event) => setCount(event.target.value)}
            />
          </Field>
          {rules.map((rule) => (
            <div className="two-col" key={rule.difficulty}>
              <Field label={examDifficultyLabels[rule.difficulty] + ' (%)'}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={rule.percent}
                  required
                  onChange={(event) => {
                    const percent = event.target.value
                    setRules((current) =>
                      current.map((item) =>
                        item.difficulty === rule.difficulty
                          ? { ...item, percent }
                          : item,
                      ),
                    )
                  }}
                />
              </Field>
              <Field
                label={
                  examDifficultyLabels[rule.difficulty] + ' marks per question'
                }
              >
                <input
                  type="number"
                  min="0.01"
                  max="99999.99"
                  step="0.01"
                  value={rule.marksEach}
                  required
                  onChange={(event) => {
                    const marksEach = event.target.value
                    setRules((current) =>
                      current.map((item) =>
                        item.difficulty === rule.difficulty
                          ? { ...item, marksEach }
                          : item,
                      ),
                    )
                  }}
                />
              </Field>
            </div>
          ))}
          <p>{percentage}% assigned. Publication requires 100%.</p>
        </fieldset>
        <div className="actions">
          <Button type="submit" disabled={disabled || !dirty}>
            Save difficulty rules
          </Button>
          {dirty && (
            <Button
              secondary
              disabled={disabled}
              onClick={() => {
                setRules(savedRules)
                setCount(savedCount)
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
      </form>
    </Panel>
  )
}
