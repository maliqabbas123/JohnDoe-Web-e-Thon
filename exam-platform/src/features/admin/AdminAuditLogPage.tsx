'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState, type FormEvent } from 'react'
import { Button, Field, Heading, Panel } from '@/components/shared'
import { api, isLive } from '@/lib/api'
import {
  accountHref,
  errorMessage,
  formatAction,
  formatTime,
  type AuditEntry,
} from './adminApi'

export function AdminAuditLogPage() {
  const search = useSearchParams()
  if (!isLive) {
    return (
      <Heading
        title="Audit log"
        subtitle="The live audit log is unavailable in demo mode."
        actions={<Button to="/admin">Administration overview</Button>}
      />
    )
  }
  const entityType = search.get('entityType')?.slice(0, 64) ?? ''
  const entityId = search.get('entityId')?.slice(0, 64) ?? ''
  return (
    <AuditLog
      key={search.toString()}
      entityType={entityType}
      entityId={entityId}
    />
  )
}

function AuditLog({
  entityType,
  entityId,
}: {
  entityType: string
  entityId: string
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [filters, setFilters] = useState(() => {
    const params = new URLSearchParams()
    if (entityType) params.set('entityType', entityType)
    if (entityId) params.set('entityId', entityId)
    return params.toString()
  })
  const [cursor, setCursor] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterError, setFilterError] = useState('')

  useEffect(() => {
    const request = new AbortController()
    const params = new URLSearchParams(filters)
    if (cursor) params.set('cursor', cursor)
    setLoading(true)
    setError('')
    api<AuditEntry[]>('/admin/audit-logs?' + params, { signal: request.signal })
      .then(({ data, meta }) => {
        if (request.signal.aborted) return
        setEntries((previous) => (cursor ? [...previous, ...data] : data))
        setNextCursor(
          typeof meta?.nextCursor === 'string' ? meta.nextCursor : null,
        )
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted)
          setError(errorMessage(failure, 'Could not load the audit log.'))
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false)
      })
    return () => request.abort()
  }, [filters, cursor, reload])

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const params = new URLSearchParams()
    for (const key of ['action', 'actorId', 'entityType', 'entityId']) {
      const value = String(values.get(key) ?? '').trim()
      if (value) params.set(key, value)
    }
    const from = String(values.get('from') ?? '')
    const to = String(values.get('to') ?? '')
    if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
      setFilterError('The end of the range must be after its start.')
      return
    }
    if (from) params.set('from', new Date(from).toISOString())
    if (to) params.set('to', new Date(to).toISOString())
    setFilterError('')
    setEntries([])
    setLoading(true)
    setNextCursor(null)
    setCursor(null)
    setFilters(params.toString())
    setReload((value) => value + 1)
  }

  return (
    <>
      <Heading
        title="Audit log"
        subtitle="Review sensitive actions across the platform."
        actions={
          <Button secondary to="/admin">
            Administration overview
          </Button>
        }
      />
      <Panel title="Filters">
        <form onSubmit={applyFilters}>
          <div className="two-col">
            <Field label="Action">
              <input
                name="action"
                pattern="[a-zA-Z_]+"
                maxLength={64}
                placeholder="LOGIN_FAILED"
              />
            </Field>
            <Field label="Actor ID">
              <input name="actorId" maxLength={64} />
            </Field>
            <Field label="Record type">
              <input
                name="entityType"
                maxLength={64}
                defaultValue={entityType}
              />
            </Field>
            <Field label="Record ID">
              <input name="entityId" maxLength={64} defaultValue={entityId} />
            </Field>
            <Field label="From (local time)">
              <input type="datetime-local" name="from" />
            </Field>
            <Field label="To (local time)">
              <input type="datetime-local" name="to" />
            </Field>
          </div>
          {filterError && <p role="alert">{filterError}</p>}
          <Button type="submit">Apply filters</Button>
        </form>
      </Panel>
      <Panel title="Audit entries">
        {loading && <p role="status">Loading audit entries…</p>}
        {error && (
          <>
            <p role="alert">{error}</p>
            <Button secondary onClick={() => setReload((value) => value + 1)}>
              Retry
            </Button>
          </>
        )}
        {!entries.length && !loading && !error && (
          <p>No matching audit entries.</p>
        )}
        {!!entries.length && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatTime(entry.createdAt)}</td>
                    <td>{formatAction(entry.action)}</td>
                    <td>
                      {entry.actor ? (
                        <Link href={accountHref(entry.actor.id)}>
                          {entry.actor.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {entry.entityType}
                      {entry.entityId && (
                        <>
                          {' '}
                          {entry.entityType === 'User' ? (
                            <Link href={accountHref(entry.entityId)}>
                              {entry.entityId}
                            </Link>
                          ) : (
                            entry.entityId
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      {entry.ip && <p>IP {entry.ip}</p>}
                      {entry.metadata &&
                        !!Object.keys(entry.metadata).length && (
                          <details>
                            <summary>Details</summary>
                            <dl>
                              {Object.entries(entry.metadata).map(
                                ([key, value]) => (
                                  <div key={key}>
                                    <dt>{key}</dt>
                                    <dd>
                                      {typeof value === 'string'
                                        ? value
                                        : JSON.stringify(value)}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          </details>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor && !error && (
          <Button
            secondary
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setCursor(nextCursor)
            }}
          >
            Load more
          </Button>
        )}
      </Panel>
    </>
  )
}
