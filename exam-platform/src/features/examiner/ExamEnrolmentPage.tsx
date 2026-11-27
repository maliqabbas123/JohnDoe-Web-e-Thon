'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Unavailable } from '@/components/auth/Unavailable'
import {
  Badge,
  Button,
  Field,
  Heading,
  Modal,
  Panel,
} from '@/components/shared'
import { api, isLive } from '@/lib/api'
import {
  examApiPath,
  examErrorDetails,
  examErrorMessage,
  examPagePath,
  formatExamDate,
  localDateInput,
  type ExamDetail,
} from './examApi'

interface Candidate {
  id: string
  name: string
  email: string
}

interface RosterEntry {
  candidate: Candidate
  createdAt: string
}

interface RetakeGrant {
  id: string
  candidateId: string
  startsAt: string
  endsAt: string
  reason: string
  attemptsAllowed: number
  revokedAt: string | null
}

const enrolmentStatuses = {
  ENROLLED: 'Enrolled',
  ALREADY_ENROLLED: 'Already enrolled',
  NOT_A_REGISTERED_CANDIDATE: 'No registered candidate',
}

interface EnrolmentOutcome {
  email: string
  status: keyof typeof enrolmentStatuses
}

const pageSize = 20

function useExamList<T>(endpoint: string) {
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ items: T[]; total: number } | null>(
    null,
  )
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setResult(null)
    setError('')
    api<T[]>(
      endpoint +
        '?' +
        new URLSearchParams({ page: String(page), pageSize: String(pageSize) }),
      { signal: controller.signal },
    )
      .then(({ data, meta }) => {
        if (controller.signal.aborted) return
        const total = typeof meta?.total === 'number' ? meta.total : data.length
        const lastPage = Math.max(1, Math.ceil(total / pageSize))
        if (page > lastPage) setPage(lastPage)
        else setResult({ items: data, total })
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(examErrorMessage(cause))
      })
    return () => controller.abort()
  }, [endpoint, page, refresh])

  return {
    page,
    setPage,
    result,
    error,
    reload: () => setRefresh((value) => value + 1),
  }
}

function Pagination({
  page,
  total,
  change,
}: {
  page: number
  total: number
  change: (page: number) => void
}) {
  if (total <= pageSize) return null
  return (
    <div className="pagination">
      <span>{total} records</span>
      <div className="actions">
        <Button
          secondary
          disabled={page === 1}
          onClick={() => change(page - 1)}
        >
          Previous
        </Button>
        <span>
          Page {page} of {Math.ceil(total / pageSize)}
        </span>
        <Button
          secondary
          disabled={page * pageSize >= total}
          onClick={() => change(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

function EnrolmentError({
  message,
  retry,
}: {
  message: string
  retry?: () => void
}) {
  return (
    <div className="actions">
      <p role="alert" className="danger">
        {message}
      </p>
      {retry && (
        <Button secondary onClick={retry}>
          Retry
        </Button>
      )}
    </div>
  )
}

function requestError(error: unknown) {
  const details = examErrorDetails(error)
  return (
    details
      .map(({ path, message }) => {
        const emailRow = /^emails\.(\d+)$/.exec(path)
        return emailRow
          ? 'Address ' + (Number(emailRow[1]) + 1) + ' — ' + message
          : message
      })
      .join(' ') || examErrorMessage(error)
  )
}

function RetakeDialog({
  endpoint,
  candidate,
  close,
  saved,
}: {
  endpoint: string
  candidate: Candidate
  close: () => void
  saved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const requestPending = useRef(false)
  const [slot] = useState(() => ({
    startsAt: localDateInput(new Date(Date.now() + 86_400_000)),
    endsAt: localDateInput(new Date(Date.now() + 172_800_000)),
  }))

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (requestPending.current) return
    const form = new FormData(event.currentTarget)
    requestPending.current = true
    setBusy(true)
    setError('')
    try {
      await api<RetakeGrant>(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          candidateId: candidate.id,
          startsAt: new Date(String(form.get('startsAt'))).toISOString(),
          endsAt: new Date(String(form.get('endsAt'))).toISOString(),
          attemptsAllowed: Number(form.get('attemptsAllowed')),
          reason: String(form.get('reason')).trim(),
        }),
      })
      saved()
    } catch (error) {
      setError(requestError(error))
    } finally {
      requestPending.current = false
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Grant a retake slot"
      close={() => {
        if (!busy) close()
      }}
    >
      <p>
        {candidate.name} · {candidate.email}
      </p>
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <Field label="Opens (local time)">
            <input
              name="startsAt"
              type="datetime-local"
              defaultValue={slot.startsAt}
              required
            />
          </Field>
          <Field label="Closes (local time)">
            <input
              name="endsAt"
              type="datetime-local"
              defaultValue={slot.endsAt}
              required
            />
          </Field>
          <Field label="Attempts allowed">
            <input
              name="attemptsAllowed"
              type="number"
              min={1}
              max={2_147_483_647}
              defaultValue={1}
              required
            />
          </Field>
          <Field label="Reason">
            <textarea name="reason" rows={3} maxLength={2_000} required />
          </Field>
        </fieldset>
        {error && <EnrolmentError message={error} />}
        <Button type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Grant slot'}
        </Button>
      </form>
    </Modal>
  )
}

function ExamRoster({ id }: { id: string }) {
  const endpoint = examApiPath(id)
  const page = examPagePath(id)
  const roster = useExamList<RosterEntry>(endpoint + '/enrollments')
  const grants = useExamList<RetakeGrant>(endpoint + '/retake-grants')
  const [title, setTitle] = useState('')
  const [emails, setEmails] = useState('')
  const [outcomes, setOutcomes] = useState<EnrolmentOutcome[] | null>(null)
  const [grantCandidate, setGrantCandidate] = useState<Candidate | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const requestPending = useRef(false)
  const rosterNames = new Map(
    roster.result?.items.map(({ candidate }) => [candidate.id, candidate.name]),
  )

  useEffect(() => {
    const controller = new AbortController()
    api<ExamDetail>(endpoint, { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setTitle(data.title)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [endpoint])

  async function act(action: () => Promise<void>) {
    if (requestPending.current) return
    requestPending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (error) {
      setError(requestError(error))
    } finally {
      requestPending.current = false
      setBusy(false)
    }
  }

  function enrol(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const addresses = emails.split(/[\s,;]+/).filter(Boolean)
    setOutcomes(null)
    if (addresses.length < 1 || addresses.length > 500) {
      setError('Enter between 1 and 500 candidate email addresses.')
      return
    }
    void act(async () => {
      const { data } = await api<EnrolmentOutcome[]>(
        endpoint + '/enrollments',
        {
          method: 'POST',
          body: JSON.stringify({ emails: addresses }),
        },
      )
      setOutcomes(data)
      setEmails(
        data
          .filter((row) => row.status === 'NOT_A_REGISTERED_CANDIDATE')
          .map((row) => row.email)
          .join('\n'),
      )
      roster.reload()
    })
  }

  function remove(candidate: Candidate) {
    const confirmed = window.confirm(
      'Remove ' +
        candidate.name +
        ' from this examination? This also removes their retake grants.',
    )
    if (!confirmed) return
    void act(async () => {
      await api<void>(
        endpoint + '/enrollments/' + encodeURIComponent(candidate.id),
        { method: 'DELETE' },
      )
      roster.reload()
      grants.reload()
      setNotice('Candidate removed.')
    })
  }

  return (
    <>
      <Heading
        title="Enrolment and retakes"
        subtitle={title || undefined}
        actions={
          <Button secondary to="/examiner">
            My examinations
          </Button>
        }
      />
      <nav className="exam-nav" aria-label="Examination tools">
        <Link href={page + '/setup'}>Setup</Link>
        <Link href={page + '/blueprint'}>Paper blueprint</Link>
        <Link href={page + '/enrolment'} aria-current="page">
          Enrolment and retakes
        </Link>
      </nav>
      {notice && <p role="status">{notice}</p>}
      {error && <EnrolmentError message={error} />}
      <Panel title="Enrol candidates">
        <form onSubmit={enrol}>
          <Field label="Candidate email addresses">
            <textarea
              value={emails}
              rows={4}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="One address per line, or separated by commas"
              required
              disabled={busy}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Enrol candidates'}
          </Button>
        </form>
        {outcomes && (
          <>
            <p role="status">
              {outcomes.filter((row) => row.status === 'ENROLLED').length} newly
              enrolled.
            </p>
            <div className="table-scroll">
              <table aria-label="Enrolment outcomes">
                <thead>
                  <tr>
                    <th scope="col">Email</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomes.map((row, index) => (
                    <tr key={index}>
                      <td>{row.email}</td>
                      <td>{enrolmentStatuses[row.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
      <Panel title="Candidate roster">
        {roster.error ? (
          <EnrolmentError message={roster.error} retry={roster.reload} />
        ) : roster.result ? (
          <>
            <div className="table-scroll">
              <table aria-label="Candidate roster">
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Enrolled</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.result.items.map(({ candidate, createdAt }) => (
                    <tr key={candidate.id}>
                      <td>
                        {candidate.name}
                        <small>{candidate.email}</small>
                      </td>
                      <td>{formatExamDate(createdAt)}</td>
                      <td>
                        <div className="actions">
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() => setGrantCandidate(candidate)}
                          >
                            Grant retake
                          </Button>
                          <Button
                            secondary
                            disabled={busy}
                            onClick={() => remove(candidate)}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!roster.result.items.length && (
                    <tr>
                      <td colSpan={3}>No candidates enrolled.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={roster.page}
              total={roster.result.total}
              change={roster.setPage}
            />
          </>
        ) : (
          <p role="status">Loading candidate roster…</p>
        )}
      </Panel>
      <Panel title="Retake grant history">
        {grants.error ? (
          <EnrolmentError message={grants.error} retry={grants.reload} />
        ) : grants.result ? (
          <>
            <div className="table-scroll">
              <table aria-label="Retake grant history">
                <thead>
                  <tr>
                    <th scope="col">Candidate</th>
                    <th scope="col">Slot</th>
                    <th scope="col">Attempts</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.result.items.map((grant) => (
                    <tr key={grant.id}>
                      <td>
                        {rosterNames.get(grant.candidateId) ||
                          grant.candidateId}
                      </td>
                      <td>
                        {formatExamDate(grant.startsAt)}
                        <small>to {formatExamDate(grant.endsAt)}</small>
                      </td>
                      <td>{grant.attemptsAllowed}</td>
                      <td>{grant.reason}</td>
                      <td>
                        <Badge>{grant.revokedAt ? 'Revoked' : 'Granted'}</Badge>
                      </td>
                    </tr>
                  ))}
                  {!grants.result.items.length && (
                    <tr>
                      <td colSpan={5}>No retake slots granted.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <Pagination
              page={grants.page}
              total={grants.result.total}
              change={grants.setPage}
            />
          </>
        ) : (
          <p role="status">Loading retake grants…</p>
        )}
      </Panel>
      {grantCandidate && (
        <RetakeDialog
          endpoint={endpoint + '/retake-grants'}
          candidate={grantCandidate}
          close={() => setGrantCandidate(null)}
          saved={() => {
            setGrantCandidate(null)
            setNotice('Retake slot granted.')
            grants.setPage(1)
            grants.reload()
          }}
        />
      )}
    </>
  )
}

export function ExamEnrolmentPage() {
  const { id } = useParams<{ id: string }>()
  return isLive ? (
    <ExamRoster key={id} id={id} />
  ) : (
    <Unavailable href={examPagePath(id) + '/setup'} />
  )
}
