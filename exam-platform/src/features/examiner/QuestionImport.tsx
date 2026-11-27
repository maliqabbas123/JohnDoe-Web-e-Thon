'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button, Field } from '@/components/shared'
import { api, ApiError } from '@/lib/api'
import { questionBankError, type QuestionTopic } from './questionBankApi'

type ImportJob = {
  id: string
  kind: 'QUESTIONS' | 'CANDIDATES'
  fileName: string
  successCount: number
  failureCount: number
  errors: { row: number; field: string; message: string }[]
  createdAt: string
}

function csvTemplate(topicId: string) {
  const escapedTopicId = '"' + topicId.replaceAll('"', '""') + '"'
  return (
    'data:text/csv;charset=utf-8,' +
    encodeURIComponent(
      'topicId,type,difficulty,text,explanation,defaultMarks,options\n' +
        escapedTopicId +
        ',WRITTEN,HARD,"Explain how you solved it.",,2,\n',
    )
  )
}

export function QuestionImport({
  topics,
  imported,
}: {
  topics: QuestionTopic[]
  imported: () => void
}) {
  const [templateTopic, setTemplateTopic] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [lastImport, setLastImport] = useState<ImportJob>()
  const [retryAt, setRetryAt] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [history, setHistory] = useState<ImportJob[]>([])
  const [historyCursor, setHistoryCursor] = useState('')
  const [nextCursor, setNextCursor] = useState('')
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [historyRevision, setHistoryRevision] = useState(0)

  useEffect(() => {
    if (!retryAt) return
    function update() {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
      setRemaining(seconds)
      if (seconds === 0) setRetryAt(0)
    }
    update()
    const timer = window.setInterval(update, 250)
    return () => window.clearInterval(timer)
  }, [retryAt])

  useEffect(() => {
    const request = new AbortController()
    const params = new URLSearchParams({ pageSize: '5' })
    if (historyCursor) params.set('cursor', historyCursor)
    setHistoryError('')
    setHistoryLoading(true)
    api<ImportJob[]>('/import/jobs?' + params, { signal: request.signal })
      .then(({ data, meta }) => {
        if (request.signal.aborted) return
        setHistory(data)
        setNextCursor(
          typeof meta?.nextCursor === 'string' ? meta.nextCursor : '',
        )
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setHistoryError(questionBankError(error))
      })
      .finally(() => {
        if (!request.signal.aborted) setHistoryLoading(false)
      })
    return () => request.abort()
  }, [historyCursor, historyRevision])

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || remaining) return
    const form = event.currentTarget
    const file = new FormData(form).get('questions')
    setUploadError('')
    if (!(file instanceof File) || !file.size) {
      setUploadError('Choose a non-empty CSV or JSON file.')
      return
    }
    const extension = file.name.toLowerCase().split('.').pop()
    if (extension !== 'csv' && extension !== 'json') {
      setUploadError('Choose a CSV or JSON file.')
      return
    }
    if (file.size > 512 * 1024) {
      setUploadError('Choose a file at most 512 KiB.')
      return
    }
    setSubmitting(true)
    setLastImport(undefined)
    try {
      const params = new URLSearchParams({ fileName: file.name })
      const { data } = await api<ImportJob>('/import/questions?' + params, {
        method: 'POST',
        headers: {
          'Content-Type': extension === 'csv' ? 'text/csv' : 'application/json',
        },
        body: file,
      })
      setLastImport(data)
      setHistoryCursor('')
      setHistoryRevision((number) => number + 1)
      form.reset()
      imported()
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 429 &&
        error.retryAfter
      ) {
        setRemaining(error.retryAfter)
        setRetryAt(Date.now() + error.retryAfter * 1000)
      }
      setUploadError(questionBankError(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <p>
        Upload up to 100 questions in a CSV or JSON file. Each question needs
        the ID of an existing topic.
      </p>
      {topics.length > 0 && (
        <>
          <Field label="Topic for CSV template">
            <select
              value={templateTopic}
              onChange={(event) => setTemplateTopic(event.target.value)}
            >
              <option value="">Select a topic</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </Field>
          {templateTopic && (
            <p>
              Topic ID <code>{templateTopic}</code>{' '}
              <a
                download="question-template.csv"
                href={csvTemplate(templateTopic)}
              >
                Download CSV template
              </a>
            </p>
          )}
        </>
      )}
      <form onSubmit={upload}>
        <Field label="Question file">
          <input
            name="questions"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            required
          />
        </Field>
        {uploadError && <p role="alert">{uploadError}</p>}
        <Button type="submit" disabled={submitting || remaining > 0}>
          {submitting
            ? 'Importing…'
            : remaining
              ? 'Retry in ' + remaining + 's'
              : 'Upload questions'}
        </Button>
      </form>
      {lastImport && (
        <section>
          <h3>Upload result</h3>
          <p role="status">{importCounts(lastImport)}</p>
          <RowErrors job={lastImport} />
        </section>
      )}
      <section>
        <h3>Import history</h3>
        {historyError ? (
          <>
            <p role="alert">{historyError}</p>
            <Button
              secondary
              onClick={() => setHistoryRevision((number) => number + 1)}
            >
              Retry
            </Button>
          </>
        ) : historyLoading ? (
          <p role="status">Loading imports…</p>
        ) : (
          <>
            {history.map((job) => (
              <details key={job.id}>
                <summary>
                  {job.fileName} · {importCounts(job)}
                </summary>
                <time dateTime={job.createdAt}>
                  {new Date(job.createdAt).toLocaleString()}
                </time>
                <RowErrors job={job} />
              </details>
            ))}
            {!history.length && <p>No imports yet.</p>}
            <div className="actions">
              {historyCursor && (
                <Button secondary onClick={() => setHistoryCursor('')}>
                  Latest imports
                </Button>
              )}
              {nextCursor && (
                <Button secondary onClick={() => setHistoryCursor(nextCursor)}>
                  Older imports
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </>
  )
}

function importCounts(job: ImportJob) {
  return job.successCount + ' imported, ' + job.failureCount + ' rejected'
}

function RowErrors({ job }: { job: ImportJob }) {
  if (!job.errors.length) return null
  return (
    <ul>
      {job.errors.map(({ row, field, message }) => (
        <li key={row}>
          Row {row} · {field}: {message}
        </li>
      ))}
    </ul>
  )
}
