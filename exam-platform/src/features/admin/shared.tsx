'use client'

import { useState } from 'react'
import { Button, Field, Modal } from '../../components/shared'
import { date, id, serverNow, useStore } from '../../context/MockStoreContext'
import type { Role, User } from '../../types'

const roles: Role[] = ['Administrator', 'Examiner', 'Candidate']

const examStatuses = ['Draft', 'Published', 'Ongoing', 'Completed']

function UserEditor({ user, close }: { user?: User; close: () => void }) {
  const { state, update, toast } = useStore(),
    [name, setName] = useState(user?.name ?? ''),
    [email, setEmail] = useState(user?.email ?? ''),
    [role, setRole] = useState<Role>(user?.role ?? 'Candidate'),
    [active, setActive] = useState(user?.active ?? true),
    [error, setError] = useState('')
  return (
    <Modal title={user ? 'Edit user' : 'Create user'} close={close}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (
            !name.trim() ||
            state.users.some(
              (x) =>
                x.email.toLowerCase() === email.trim().toLowerCase() &&
                x.id !== user?.id,
            )
          ) {
            setError('Enter a name and a unique email address.')
            return
          }
          update((s) => {
            const old = s.users.find((x) => x.id === user?.id)
            if (old) {
              if (old.role !== role)
                old.history.unshift(role + ' assigned on ' + date(serverNow()))
              Object.assign(old, {
                name: name.trim(),
                email: email.trim(),
                role,
                active,
              })
            } else
              s.users.push({
                id: id(),
                name: name.trim(),
                email: email.trim(),
                role,
                active,
                password: 'Demo2026!',
                history: [role + ' assigned at creation'],
                logins: [],
              })
            s.audit.unshift({
              type: 'Access',
              at: serverNow(),
              message: (user ? 'Updated ' : 'Created ') + name,
            })
          })
          toast('User saved.')
          close()
        }}
      >
        <Field label="Full name">
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Email">
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Role">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
          >
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />{' '}
          Active account
        </label>
        {error && <p role="alert">{error}</p>}
        <Button type="submit">Save user</Button>
      </form>
    </Modal>
  )
}

export { examStatuses, roles, UserEditor }
