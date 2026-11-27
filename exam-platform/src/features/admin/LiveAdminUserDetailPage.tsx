'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Badge, Button, Heading, Modal, Panel } from '@/components/shared'
import { useAuth } from '@/context/AuthContext'
import { api } from '@/lib/api'
import {
  accountPath,
  accountRoles,
  errorMessage,
  formatAction,
  formatTime,
  type Account,
  type AccountActivity,
} from './adminApi'
import { LiveAccountEditor } from './LiveAccountEditor'

type AccessAction = 'sessions' | 'sign-in-lock'

export function LiveAdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  return <AccountDetails key={userId} userId={userId} />
}

function AccountDetails({ userId }: { userId: string }) {
  const { user } = useAuth()
  const [account, setAccount] = useState<Account>()
  const [activity, setActivity] = useState<AccountActivity>()
  const [error, setError] = useState('')
  const [activityError, setActivityError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [edit, setEdit] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [pending, setPending] = useState<AccessAction>()
  const path = accountPath(userId)
  const auditHref =
    '/admin/audit-logs?' +
    new URLSearchParams({ entityType: 'User', entityId: userId })

  useEffect(() => {
    const request = new AbortController()
    setError('')
    setActivityError('')
    api<Account>(path, { signal: request.signal })
      .then(({ data }) => {
        if (!request.signal.aborted) setAccount(data)
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted)
          setError(errorMessage(failure, 'Could not load this account.'))
      })
    api<AccountActivity>(path + '/activity', { signal: request.signal })
      .then(({ data }) => {
        if (!request.signal.aborted) setActivity(data)
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted)
          setActivityError(
            errorMessage(failure, 'Could not load account activity.'),
          )
      })
    return () => request.abort()
  }, [path, refresh])

  async function updateAccess(action: AccessAction) {
    if (pending) return
    setPending(action)
    setMutationError('')
    setNotice('')
    try {
      await api<undefined>(path + '/' + action, { method: 'DELETE' })
      setConfirmSignOut(false)
      setNotice(
        action === 'sessions'
          ? 'Active sessions ended.'
          : 'Sign-in lock lifted.',
      )
      setRefresh((value) => value + 1)
    } catch (failure) {
      setMutationError(
        errorMessage(failure, 'Could not update account access.'),
      )
    } finally {
      setPending(undefined)
    }
  }

  if (!account) {
    return (
      <>
        <Heading
          title="User account"
          actions={<Button to="/admin">User directory</Button>}
        />
        {error ? (
          <>
            <p role="alert">{error}</p>
            <Button secondary onClick={() => setRefresh((value) => value + 1)}>
              Retry
            </Button>
          </>
        ) : (
          <p role="status">Loading account…</p>
        )}
      </>
    )
  }

  return (
    <>
      <Heading
        title={account.name}
        subtitle={account.email}
        actions={
          <>
            <Button secondary to="/admin">
              User directory
            </Button>
            <Button onClick={() => setEdit(true)}>Edit account</Button>
          </>
        }
      />
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      {!confirmSignOut && mutationError && <p role="alert">{mutationError}</p>}
      <Panel title="Access profile">
        <p>
          <Badge>{accountRoles[account.role]}</Badge>{' '}
          <Badge>{account.isActive ? 'Active' : 'Inactive'}</Badge>
        </p>
        <p>Created {formatTime(account.createdAt)}</p>
        <p>Updated {formatTime(account.updatedAt)}</p>
        {activity?.signInLock.locked && (
          <p>
            Sign-in locked
            {activity.signInLock.until
              ? ' until ' + formatTime(activity.signInLock.until)
              : ''}
            .
          </p>
        )}
        <div className="actions">
          {activity?.signInLock.locked && (
            <Button
              secondary
              disabled={!!pending}
              onClick={() => void updateAccess('sign-in-lock')}
            >
              {pending === 'sign-in-lock' ? 'Unlocking…' : 'Unlock sign-in'}
            </Button>
          )}
          {account.id !== user?.id && !!activity?.sessions.length && (
            <Button
              secondary
              disabled={!!pending}
              onClick={() => {
                setMutationError('')
                setConfirmSignOut(true)
              }}
            >
              Sign out everywhere
            </Button>
          )}
        </div>
      </Panel>
      {activityError && (
        <>
          <p role="alert">{activityError}</p>
          <Button secondary onClick={() => setRefresh((value) => value + 1)}>
            Retry activity
          </Button>
        </>
      )}
      {!activity && !activityError && (
        <p role="status">Loading account activity…</p>
      )}
      {activity && (
        <div className="two-col">
          <Panel title="Active sessions">
            {activity.sessions.length ? (
              activity.sessions.map((session) => (
                <div key={session.id}>
                  <p>Signed in {formatTime(session.createdAt)}</p>
                  <p>Last seen {formatTime(session.lastSeenAt)}</p>
                  <p>Expires {formatTime(session.expiresAt)}</p>
                  {session.ip && <p>{session.ip}</p>}
                  {session.userAgent && <p>{session.userAgent}</p>}
                </div>
              ))
            ) : (
              <p>No active sessions.</p>
            )}
          </Panel>
          <Panel title="Recent sign-in attempts">
            {activity.signIns.length ? (
              <ul>
                {activity.signIns.map((signIn) => (
                  <li key={signIn.id}>
                    <Badge>{signIn.succeeded ? 'Succeeded' : 'Failed'}</Badge>{' '}
                    {formatTime(signIn.createdAt)}
                    {signIn.ip ? ' · ' + signIn.ip : ''}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No sign-in attempts recorded.</p>
            )}
          </Panel>
          <Panel title="Recent account changes">
            {activity.accountChanges.length ? (
              <ul>
                {activity.accountChanges.map((change) => (
                  <li key={change.id}>
                    {formatAction(change.action)} ·{' '}
                    {formatTime(change.createdAt)}
                    {change.actor && ' · ' + change.actor.name}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No changes recorded.</p>
            )}
            <Link href={auditHref}>View audit history</Link>
          </Panel>
        </div>
      )}
      {edit && (
        <LiveAccountEditor
          account={account}
          close={() => setEdit(false)}
          onSaved={(saved) => {
            setAccount(saved)
            setEdit(false)
            setNotice('Account updated.')
            setRefresh((value) => value + 1)
          }}
        />
      )}
      {confirmSignOut && (
        <Modal
          title="Sign out everywhere"
          close={() => {
            if (!pending) setConfirmSignOut(false)
          }}
        >
          <p>
            This ends all active sessions for {account.name}. They can sign in
            again.
          </p>
          {mutationError && <p role="alert">{mutationError}</p>}
          <div className="actions">
            <Button
              secondary
              disabled={!!pending}
              onClick={() => setConfirmSignOut(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={!!pending}
              onClick={() => void updateAccess('sessions')}
            >
              {pending === 'sessions' ? 'Signing out…' : 'Sign out everywhere'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
