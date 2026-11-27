'use client'

import { useState, type FormEvent } from 'react'
import { Button, Field, Modal } from '@/components/shared'
import { useAuth } from '@/context/AuthContext'
import { api, ApiError } from '@/lib/api'
import {
  accountPath,
  accountRoles,
  errorMessage,
  type Account,
  type AccountRole,
} from './adminApi'

export function LiveAccountEditor({
  account,
  close,
  onSaved,
}: {
  account?: Account
  close: () => void
  onSaved: (account: Account) => void
}) {
  const { user } = useAuth()
  const editingSelf = account?.id === user?.id
  const [name, setName] = useState(account?.name ?? '')
  const [email, setEmail] = useState(account?.email ?? '')
  const [role, setRole] = useState<AccountRole>(account?.role ?? 'CANDIDATE')
  const [isActive, setActive] = useState(account?.isActive ?? true)
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const patch: Partial<Pick<Account, 'name' | 'role' | 'isActive'>> & {
    password?: string
  } = {}
  if (account) {
    if (name.trim() !== account.name) patch.name = name.trim()
    if (!editingSelf && role !== account.role) patch.role = role
    if (!editingSelf && isActive !== account.isActive) patch.isActive = isActive
    if (password) patch.password = password
  }
  const endsSession =
    patch.role !== undefined || patch.isActive === false || !!patch.password

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || (account && Object.keys(patch).length === 0)) return
    if (!name.trim()) {
      setError('Enter a name.')
      return
    }
    setPending(true)
    setError('')
    setFieldErrors({})
    try {
      const response = await api<Account>(
        account ? accountPath(account.id) : '/users',
        {
          method: account ? 'PATCH' : 'POST',
          body: JSON.stringify(
            account
              ? patch
              : { name: name.trim(), email: email.trim(), role, password },
          ),
        },
      )
      onSaved(response.data)
    } catch (failure) {
      if (
        failure instanceof ApiError &&
        failure.status === 422 &&
        failure.details?.length
      ) {
        const errors = Object.fromEntries(
          failure.details.map(({ path, message }) => [path, message]),
        )
        setFieldErrors(errors)
        const unexpected = failure.details.find(
          ({ path }) =>
            !['name', 'email', 'role', 'isActive', 'password'].includes(path),
        )
        if (unexpected) setError(unexpected.message)
      } else {
        setError(errorMessage(failure, 'Could not save the account.'))
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal
      title={account ? 'Edit account' : 'Create account'}
      close={() => {
        if (!pending) close()
      }}
    >
      <form onSubmit={submit}>
        <fieldset disabled={pending}>
          <Field label="Full name">
            <input
              required
              maxLength={120}
              value={name}
              aria-invalid={!!fieldErrors.name}
              onChange={(event) => setName(event.target.value)}
            />
            {fieldErrors.name && <small role="alert">{fieldErrors.name}</small>}
          </Field>
          <Field label="Email">
            <input
              type="email"
              required
              maxLength={254}
              value={email}
              readOnly={!!account}
              aria-invalid={!!fieldErrors.email}
              onChange={(event) => setEmail(event.target.value)}
            />
            {fieldErrors.email && (
              <small role="alert">{fieldErrors.email}</small>
            )}
          </Field>
          <Field label="Role">
            <select
              value={role}
              disabled={editingSelf}
              aria-invalid={!!fieldErrors.role}
              onChange={(event) => setRole(event.target.value as AccountRole)}
            >
              {Object.entries(accountRoles).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            {fieldErrors.role && <small role="alert">{fieldErrors.role}</small>}
          </Field>
          {account && (
            <label className="check">
              <input
                type="checkbox"
                checked={isActive}
                disabled={editingSelf}
                aria-invalid={!!fieldErrors.isActive}
                onChange={(event) => setActive(event.target.checked)}
              />{' '}
              Active account
            </label>
          )}
          {fieldErrors.isActive && (
            <small role="alert">{fieldErrors.isActive}</small>
          )}
          <Field
            label={account ? 'New password (optional)' : 'Initial password'}
          >
            <input
              type="password"
              autoComplete="new-password"
              required={!account}
              minLength={8}
              maxLength={128}
              value={password}
              aria-invalid={!!fieldErrors.password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {fieldErrors.password && (
              <small role="alert">{fieldErrors.password}</small>
            )}
          </Field>
          {!account && (
            <p>
              Use at least 8 characters and share the password directly with the
              account holder.
            </p>
          )}
          {endsSession && (
            <p role="status">
              Saving these changes signs {editingSelf ? 'you' : 'this user'} out
              everywhere.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button
            type="submit"
            disabled={pending || (!!account && Object.keys(patch).length === 0)}
          >
            {pending ? 'Saving…' : 'Save account'}
          </Button>
        </fieldset>
      </form>
    </Modal>
  )
}
