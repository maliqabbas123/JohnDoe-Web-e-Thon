'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Heading, Panel } from '../../components/shared'
import { date, serverNow, useStore } from '../../context/MockStoreContext'

import { UserEditor } from './shared'

export function AdminUserDetailPage() {
  const { userId } = useParams<{ userId: string }>(),
    { state, update, toast, user } = useStore(),
    [edit, set] = useState(false)
  const u = state.users.find((u) => u.id === userId)
  if (!u)
    return (
      <Heading
        title="User not found"
        actions={<Button to="/admin">User directory</Button>}
      />
    )
  const invite = Object.entries(state.tokens).find(
    ([, v]) => v.user === u.id && v.purpose === 'invite',
  )
  return (
    <>
      <Heading
        title={u.name}
        subtitle={u.email}
        actions={<Button onClick={() => set(true)}>Edit account</Button>}
      />
      <div className="two-col">
        <Panel title="Access profile">
          <p>
            <Badge>{u.role}</Badge>{' '}
            <Badge>{u.active ? 'Active' : 'Inactive'}</Badge>
          </p>
          {invite && (
            <p>
              <Link href={'/invite/' + invite[0]}>Open activation link</Link>
            </p>
          )}
          <Button
            secondary
            disabled={u.id === user?.id}
            onClick={() => {
              update((s) => {
                s.users.find((x) => x.id === u.id)!.revokedAt = serverNow()
                s.audit.unshift({
                  type: 'Access',
                  at: serverNow(),
                  message: 'Revoked access for ' + u.name,
                })
              })
              toast('Active sessions revoked.')
            }}
          >
            Revoke active sessions
          </Button>
        </Panel>
        <Panel title="Role assignment history">
          <ul>
            {u.history.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </Panel>
        <Panel title="Associated examinations">
          {state.exams
            .filter((e) => e.owner === u.id || e.candidates.includes(u.id))
            .map((e) => (
              <p key={e.id}>
                {e.title} <Badge>{e.status}</Badge>
              </p>
            )) || null}
          {!state.exams.some(
            (e) => e.owner === u.id || e.candidates.includes(u.id),
          ) && <p>No examinations assigned.</p>}
        </Panel>
        <Panel title="Login history">
          {u.logins.length ? (
            u.logins.map((t, i) => <p key={i}>{date(t)}</p>)
          ) : (
            <p>No logins recorded.</p>
          )}
        </Panel>
      </div>
      {edit && <UserEditor user={u} close={() => set(false)} />}
    </>
  )
}
