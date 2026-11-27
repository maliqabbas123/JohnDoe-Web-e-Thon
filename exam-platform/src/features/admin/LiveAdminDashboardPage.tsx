'use client'

import Link from 'next/link'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge, Button, Heading, Panel, Stats } from '@/components/shared'
import { api } from '@/lib/api'
import {
  accountHref,
  accountRoles,
  errorMessage,
  formatTime,
  type Account,
  type Overview,
} from './adminApi'
import { LiveAccountEditor } from './LiveAccountEditor'

const pageSize = 20

export function LiveAdminDashboardPage() {
  const [overview, setOverview] = useState<Overview>()
  const [overviewError, setOverviewError] = useState('')
  const [rows, setRows] = useState<Account[]>([])
  const [directoryError, setDirectoryError] = useState('')
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [active, setActive] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [editor, setEditor] = useState<Account | null>()
  const [notice, setNotice] = useState('')
  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim() !== search) {
        setSearch(query.trim())
        setPage(1)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, search])

  useEffect(() => {
    const request = new AbortController()
    setOverviewError('')
    api<Overview>('/admin/overview', { signal: request.signal })
      .then(({ data }) => {
        if (!request.signal.aborted) setOverview(data)
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted)
          setOverviewError(
            errorMessage(failure, 'Could not load the overview.'),
          )
      })
    return () => request.abort()
  }, [refresh])

  useEffect(() => {
    const request = new AbortController()
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (search) params.set('q', search)
    if (role) params.set('role', role)
    if (active) params.set('isActive', active)
    setDirectoryLoading(true)
    setDirectoryError('')
    api<Account[]>('/users?' + params, { signal: request.signal })
      .then(({ data, meta }) => {
        if (request.signal.aborted) return
        const count = typeof meta?.total === 'number' ? meta.total : data.length
        setTotal(count)
        const last = Math.max(1, Math.ceil(count / pageSize))
        if (page > last) {
          setPage(last)
          return
        }
        setRows(data)
        setDirectoryLoading(false)
      })
      .catch((failure: unknown) => {
        if (request.signal.aborted) return
        setDirectoryError(
          errorMessage(failure, 'Could not load the user directory.'),
        )
        setDirectoryLoading(false)
      })
    return () => request.abort()
  }, [page, search, role, active, refresh])

  return (
    <>
      <Heading
        title="Administration overview"
        subtitle="Manage accounts and review platform activity."
        actions={
          <>
            <Button secondary to="/admin/audit-logs">
              Audit log
            </Button>
            <Button onClick={() => setEditor(null)}>Create account</Button>
          </>
        }
      />
      {notice && <p role="status">{notice}</p>}
      {overviewError && <p role="alert">{overviewError}</p>}
      {overview ? (
        <>
          <Stats
            items={[
              ['Active accounts', overview.users.active],
              ['Inactive accounts', overview.users.inactive],
              ['Ongoing exams', overview.exams.ongoing],
              ['Upcoming exams', overview.exams.upcoming],
              ['Completed exams', overview.exams.completed],
              ['Attempts in progress', overview.attempts.inProgress],
              ['Open disputes', overview.disputes.open],
              ['Active sessions', overview.sessions.active],
              [
                'Failed sign-ins (24h)',
                overview.security.failedSignInsLast24Hours,
              ],
            ]}
          />
          <div className="actions">
            <span>Updated {formatTime(overview.serverTime)}</span>
            <Button secondary onClick={() => setRefresh((value) => value + 1)}>
              Refresh
            </Button>
          </div>
        </>
      ) : overviewError ? (
        <Button secondary onClick={() => setRefresh((value) => value + 1)}>
          Retry overview
        </Button>
      ) : (
        <p role="status">Loading platform counts…</p>
      )}
      <Panel title="User directory">
        <div className="table-tools">
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search by name or email"
              placeholder="Search name or email"
              maxLength={100}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select
            aria-label="Role"
            value={role}
            onChange={(event) => {
              setRole(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All roles</option>
            {Object.entries(accountRoles).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Account status"
            value={active}
            onChange={(event) => {
              setActive(event.target.value)
              setPage(1)
            }}
          >
            <option value="">All statuses</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>
        </div>
        {directoryLoading && <p role="status">Loading accounts…</p>}
        {directoryError && (
          <>
            <p role="alert">{directoryError}</p>
            <Button secondary onClick={() => setRefresh((value) => value + 1)}>
              Retry directory
            </Button>
          </>
        )}
        {!directoryLoading && !directoryError && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((account) => (
                    <tr key={account.id}>
                      <td>
                        <Link href={accountHref(account.id)}>
                          {account.name}
                        </Link>
                      </td>
                      <td>{account.email}</td>
                      <td>{accountRoles[account.role]}</td>
                      <td>
                        <Badge>
                          {account.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td>
                        <Button secondary onClick={() => setEditor(account)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5}>No matching accounts.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {total} {total === 1 ? 'account' : 'accounts'}
              </span>
              <div className="actions">
                <Button
                  secondary
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {lastPage}
                </span>
                <Button
                  secondary
                  disabled={page === lastPage}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
      {editor !== undefined && (
        <LiveAccountEditor
          account={editor ?? undefined}
          close={() => setEditor(undefined)}
          onSaved={() => {
            setEditor(undefined)
            setNotice(editor ? 'Account updated.' : 'Account created.')
            if (!editor) setPage(1)
            setRefresh((value) => value + 1)
          }}
        />
      )}
    </>
  )
}
