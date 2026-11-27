'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  Field,
  Heading,
  Modal,
  Panel,
} from '@/components/shared'
import { api } from '@/lib/api'
import {
  examErrorDetails,
  examErrorMessage,
  examPagePath,
  examStates,
  formatExamDate,
  localDateInput,
  type ExamDetail,
  type ExamSettingsInput,
  type ExamState,
  type ExamSummary,
} from './examApi'

const pageSize = 20

function CreateExamDialog({ close }: { close: () => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [initialSlot] = useState(() => ({
    startsAt: localDateInput(new Date(Date.now() + 86_400_000)),
    endsAt: localDateInput(new Date(Date.now() + 172_800_000)),
  }))

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError('')
    try {
      const payload: ExamSettingsInput = {
        title: String(form.get('title')).trim(),
        startsAt: new Date(String(form.get('startsAt'))).toISOString(),
        endsAt: new Date(String(form.get('endsAt'))).toISOString(),
        durationMinutes: Number(form.get('durationMinutes')),
        totalMarks: Number(form.get('totalMarks')),
      }
      const { data } = await api<ExamDetail>('/exams', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      router.push(examPagePath(data.id) + '/setup')
    } catch (error) {
      const details = examErrorDetails(error)
      setError(
        details.map((issue) => issue.message).join(' ') ||
          examErrorMessage(error),
      )
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create examination"
      close={() => {
        if (!busy) close()
      }}
    >
      <form onSubmit={create}>
        <fieldset disabled={busy}>
          <Field label="Title">
            <input name="title" maxLength={200} required autoFocus />
          </Field>
          <Field label="Opens (local time)">
            <input
              name="startsAt"
              type="datetime-local"
              defaultValue={initialSlot.startsAt}
              required
            />
          </Field>
          <Field label="Closes (local time)">
            <input
              name="endsAt"
              type="datetime-local"
              defaultValue={initialSlot.endsAt}
              required
            />
          </Field>
          <Field label="Duration in minutes">
            <input
              name="durationMinutes"
              type="number"
              min={1}
              max={2_147_483_647}
              defaultValue={60}
              required
            />
          </Field>
          <Field label="Total marks">
            <input
              name="totalMarks"
              type="number"
              min="0.01"
              max="99999.99"
              step="0.01"
              defaultValue={20}
              required
            />
          </Field>
        </fieldset>
        {error && (
          <p className="danger" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create draft'}
        </Button>
      </form>
    </Modal>
  )
}

export function LiveExamDirectory() {
  const [filter, setFilter] = useState<ExamState | ''>('')
  const [page, setPage] = useState(1)
  const [create, setCreate] = useState(false)
  const [retry, setRetry] = useState(0)
  const [list, setList] = useState<{
    exams: ExamSummary[]
    total: number
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (filter) query.set('state', filter)
    setError('')
    setList(null)
    api<ExamSummary[]>('/exams?' + query, { signal: controller.signal })
      .then(({ data, meta }) => {
        if (controller.signal.aborted) return
        const total = typeof meta?.total === 'number' ? meta.total : data.length
        const lastPage = Math.max(1, Math.ceil(total / pageSize))
        if (page > lastPage) setPage(lastPage)
        else setList({ exams: data, total })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(examErrorMessage(error))
      })
    return () => controller.abort()
  }, [filter, page, retry])

  return (
    <>
      <Heading
        title="My examinations"
        subtitle="Create and publish assessments."
        actions={
          <Button onClick={() => setCreate(true)}>Create examination</Button>
        }
      />
      <Panel title="Examination directory">
        <div className="table-tools">
          <select
            aria-label="Filter by examination status"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as ExamState | '')
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(examStates).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {error ? (
          <div className="actions">
            <p className="danger" role="alert">
              {error}
            </p>
            <Button secondary onClick={() => setRetry(retry + 1)}>
              Retry
            </Button>
          </div>
        ) : list ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Examination</th>
                    <th scope="col">Status</th>
                    <th scope="col">Opens</th>
                    <th scope="col">Duration</th>
                    <th scope="col">Marks</th>
                  </tr>
                </thead>
                <tbody>
                  {list.exams.map((exam) => (
                    <tr key={exam.id}>
                      <td>
                        <Link href={examPagePath(exam.id) + '/setup'}>
                          {exam.title}
                        </Link>
                      </td>
                      <td>
                        <Badge>{examStates[exam.state]}</Badge>
                      </td>
                      <td>{formatExamDate(exam.startsAt)}</td>
                      <td>{exam.durationMinutes} min</td>
                      <td>{exam.totalMarks}</td>
                    </tr>
                  ))}
                  {!list.exams.length && (
                    <tr>
                      <td colSpan={5}>No examinations found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {list.total > pageSize && (
              <div className="pagination">
                <span>{list.total} examinations</span>
                <div className="actions">
                  <Button
                    secondary
                    disabled={page === 1}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </Button>
                  <span>
                    Page {page} of {Math.ceil(list.total / pageSize)}
                  </span>
                  <Button
                    secondary
                    disabled={page * pageSize >= list.total}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <p role="status">Loading examinations…</p>
        )}
      </Panel>
      {create && <CreateExamDialog close={() => setCreate(false)} />}
    </>
  )
}
