'use client'

import { useParams } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  Field,
  Heading,
  Panel,
  SlideOverDrawer,
} from '@/components/shared'
import { api, ApiError } from '@/lib/api'
import { LiveExamNav } from './LiveExamNav'

type Attempt = {
  id: string
  candidate: { id: string; name: string }
  attemptNumber: number
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'EXPIRED'
  connection: 'ONLINE' | 'INTERRUPTED'
  lastSeenAt: string
  deadlineAt: string
  currentPosition: number
  questionCount: number
  answeredCount: number
  incidentCount: number
  disruptionCount: number
  latestDisruption: { startedAt: string; endedAt: string | null } | null
}

type Announcement = { id: string; message: string; createdAt: string }

const statusLabels = {
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  EXPIRED: 'Expired',
}

type ClockSample = { serverTime: string; receivedAt: number }

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Could not contact the examination service.'
}

function pagePath(
  endpoint: string,
  pageSize: number,
  cursor: string | undefined,
) {
  const params = new URLSearchParams({ pageSize: String(pageSize) })
  if (cursor) params.set('cursor', cursor)
  return endpoint + '?' + params
}

function nextCursor(meta: Record<string, unknown> | undefined) {
  return typeof meta?.nextCursor === 'string' ? meta.nextCursor : undefined
}

function Time({ value }: { value: string }) {
  return (
    <time dateTime={value}>
      {new Date(value).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      })}
    </time>
  )
}

function Pagination({
  previous,
  next,
}: {
  previous?: () => void
  next?: () => void
}) {
  if (!previous && !next) return null
  return (
    <div className="pagination">
      <div className="actions">
        <Button secondary onClick={previous} disabled={!previous}>
          Previous
        </Button>
        <Button secondary onClick={next} disabled={!next}>
          Next
        </Button>
      </div>
    </div>
  )
}

export function LiveExamMonitor() {
  const { id } = useParams<{ id: string }>()
  return <ExamMonitor key={id} id={id} />
}

function ExamMonitor({ id }: { id: string }) {
  const [title, setTitle] = useState('')
  const endpoint = '/exams/' + encodeURIComponent(id)

  useEffect(() => {
    const request = new AbortController()
    api<{ title: string }>(endpoint, { signal: request.signal })
      .then(({ data }) => {
        if (!request.signal.aborted) setTitle(data.title)
      })
      .catch(() => {
        // The monitor and announcement requests show their own errors.
      })
    return () => request.abort()
  }, [endpoint])

  return (
    <>
      <Heading
        title="Live examination monitor"
        subtitle={title || undefined}
        actions={
          <Button secondary to="/examiner">
            My examinations
          </Button>
        }
      />
      <LiveExamNav id={id} current="live" />
      <div className="two-col wide-left">
        <AttemptMonitor endpoint={endpoint + '/monitor'} />
        <AnnouncementPanel endpoint={endpoint + '/announcements'} />
      </div>
    </>
  )
}

function AttemptMonitor({ endpoint }: { endpoint: string }) {
  const [snapshot, setSnapshot] = useState<{
    attempts: Attempt[]
    clock?: ClockSample
    next?: string
  }>()
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const cursor = cursorStack.at(-1)

  useEffect(() => {
    const request = new AbortController()
    let timer: number | undefined

    async function poll() {
      try {
        const { data, meta } = await api<Attempt[]>(
          pagePath(endpoint, 24, cursor),
          { signal: request.signal },
        )
        if (request.signal.aborted) return
        setSnapshot({
          attempts: data,
          next: nextCursor(meta),
          clock:
            typeof meta?.serverTime === 'string'
              ? { serverTime: meta.serverTime, receivedAt: performance.now() }
              : undefined,
        })
        setError('')
      } catch (error) {
        if (request.signal.aborted) return
        setError(errorMessage(error))
        if (
          error instanceof ApiError &&
          [401, 403, 404, 422].includes(error.status)
        )
          return
      }
      timer = window.setTimeout(poll, 5000)
    }

    void poll()
    return () => {
      request.abort()
      window.clearTimeout(timer)
    }
  }, [cursor, endpoint, revision])

  function showPage(nextStack: string[]) {
    setSnapshot(undefined)
    setSelectedId('')
    setError('')
    setCursorStack(nextStack)
  }

  const selected = snapshot?.attempts.find(
    (attempt) => attempt.id === selectedId,
  )
  const more = snapshot?.next

  return (
    <Panel title="Candidate activity">
      {error && (
        <div>
          <p role="alert" className="danger">
            {error}
          </p>
          <Button
            secondary
            onClick={() => {
              setError('')
              setRevision((previous) => previous + 1)
            }}
          >
            Refresh activity
          </Button>
        </div>
      )}
      {snapshot ? (
        <>
          {snapshot.clock && (
            <p>
              Last updated <Time value={snapshot.clock.serverTime} />
            </p>
          )}
          {snapshot.attempts.length ? (
            <div className="monitor-grid">
              {snapshot.attempts.map((attempt) => (
                <AttemptCard
                  key={attempt.id}
                  attempt={attempt}
                  clock={snapshot.clock}
                  details={() => setSelectedId(attempt.id)}
                />
              ))}
            </div>
          ) : (
            <p>
              {cursor
                ? 'No attempts on this page.'
                : 'No attempts have started.'}
            </p>
          )}
          <Pagination
            previous={
              cursor ? () => showPage(cursorStack.slice(0, -1)) : undefined
            }
            next={more ? () => showPage([...cursorStack, more]) : undefined}
          />
        </>
      ) : (
        !error && <p role="status">Loading candidate activity…</p>
      )}
      {selected && (
        <SlideOverDrawer
          title="Attempt signals"
          close={() => setSelectedId('')}
        >
          <p>
            {selected.candidate.name} · Attempt {selected.attemptNumber}
          </p>
          <dl>
            <dt>Last contact</dt>
            <dd>
              <Time value={selected.lastSeenAt} />
            </dd>
            <dt>Incident signals</dt>
            <dd>{selected.incidentCount}</dd>
            <dt>Connection disruptions</dt>
            <dd>{selected.disruptionCount}</dd>
            {selected.latestDisruption && (
              <>
                <dt>Latest interruption started</dt>
                <dd>
                  <Time value={selected.latestDisruption.startedAt} />
                </dd>
                <dt>Contact restored</dt>
                <dd>
                  {selected.latestDisruption.endedAt ? (
                    <Time value={selected.latestDisruption.endedAt} />
                  ) : (
                    'Awaiting contact'
                  )}
                </dd>
              </>
            )}
          </dl>
        </SlideOverDrawer>
      )}
    </Panel>
  )
}

function AttemptCard({
  attempt,
  clock,
  details,
}: {
  attempt: Attempt
  clock?: ClockSample
  details: () => void
}) {
  const active = attempt.status === 'IN_PROGRESS'
  const connection =
    attempt.connection === 'ONLINE' ? 'Online' : 'Connection interrupted'
  return (
    <article>
      <strong>{attempt.candidate.name}</strong>
      <p>Attempt {attempt.attemptNumber}</p>
      <div className="actions">
        <Badge>{statusLabels[attempt.status]}</Badge>
        {active && <Badge>{connection}</Badge>}
      </div>
      <progress
        aria-label="Questions answered"
        max={attempt.questionCount || 1}
        value={attempt.answeredCount}
      />
      <p>
        {attempt.answeredCount} / {attempt.questionCount} answered
      </p>
      {active && (
        <>
          {attempt.currentPosition > 0 && (
            <p>Current question {attempt.currentPosition}</p>
          )}
          {clock ? (
            <Deadline deadline={attempt.deadlineAt} clock={clock} />
          ) : (
            <p>
              Deadline <Time value={attempt.deadlineAt} />
            </p>
          )}
        </>
      )}
      <Button secondary onClick={details}>
        {'Incidents (' +
          attempt.incidentCount +
          ') · Gaps (' +
          attempt.disruptionCount +
          ')'}
      </Button>
    </article>
  )
}

function Deadline({
  deadline,
  clock,
}: {
  deadline: string
  clock: ClockSample
}) {
  const [tick, setTick] = useState(clock.receivedAt)
  useEffect(() => {
    const timer = window.setInterval(() => setTick(performance.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, tick - clock.receivedAt)
  const seconds = Math.max(
    0,
    Math.ceil(
      (Date.parse(deadline) - Date.parse(clock.serverTime) - elapsed) / 1000,
    ),
  )
  const minutes = Math.floor(seconds / 60)
  const remaining = String(seconds % 60).padStart(2, '0')
  return (
    <p>
      {seconds ? minutes + ':' + remaining + ' remaining' : 'Deadline reached'}
    </p>
  )
}

function AnnouncementPanel({ endpoint }: { endpoint: string }) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [sendError, setSendError] = useState('')
  const [loading, setLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [items, setItems] = useState<Announcement[]>([])
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [more, setMore] = useState<string>()
  const [revision, setRevision] = useState(0)
  const cursor = cursorStack.at(-1)

  useEffect(() => {
    const request = new AbortController()
    api<Announcement[]>(pagePath(endpoint, 20, cursor), {
      signal: request.signal,
    })
      .then(({ data, meta }) => {
        if (request.signal.aborted) return
        setItems(data)
        setMore(nextCursor(meta))
        setHistoryError('')
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setHistoryError(errorMessage(error))
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false)
      })
    return () => request.abort()
  }, [cursor, endpoint, revision])

  function showPage(nextStack: string[]) {
    setLoading(true)
    setHistoryError('')
    setCursorStack(nextStack)
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = message.trim()
    if (!text || sending) return
    setSending(true)
    setSendError('')
    setNotice('')
    try {
      await api<Announcement>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      })
      setMessage('')
      setNotice('Announcement sent.')
      setRevision((previous) => previous + 1)
    } catch (error) {
      setSendError(errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  return (
    <Panel title="Broadcast announcements">
      <form onSubmit={send}>
        <Field label="Message to candidates">
          <textarea
            required
            maxLength={1000}
            value={message}
            disabled={sending}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
        <Button type="submit" disabled={sending || !message.trim()}>
          {sending ? 'Sending…' : 'Send announcement'}
        </Button>
        {notice && <p role="status">{notice}</p>}
        {sendError && (
          <p role="alert" className="danger">
            {sendError}
          </p>
        )}
      </form>
      <h3>Announcement history</h3>
      {loading ? (
        <p role="status">Loading announcements…</p>
      ) : historyError ? (
        <>
          <p role="alert" className="danger">
            {historyError}
          </p>
          <Button
            secondary
            onClick={() => {
              setLoading(true)
              setRevision((previous) => previous + 1)
            }}
          >
            Retry
          </Button>
        </>
      ) : (
        <>
          <div className="timeline">
            {items.map((item) => (
              <article key={item.id}>
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {item.message}
                </p>
                <small>
                  <Time value={item.createdAt} />
                </small>
              </article>
            ))}
            {!items.length && <p>No announcements sent.</p>}
          </div>
          <Pagination
            previous={
              cursor ? () => showPage(cursorStack.slice(0, -1)) : undefined
            }
            next={more ? () => showPage([...cursorStack, more]) : undefined}
          />
        </>
      )}
    </Panel>
  )
}
