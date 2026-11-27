'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button, Field } from '@/components/shared'
import { useAuth, type ApiUser } from '@/context/AuthContext'
import { home } from '@/context/MockStoreContext'
import { api, ApiError } from '@/lib/api'
import { Password, PublicCard } from './shared'

export function LiveAccountForm({ signup = false }: { signup?: boolean }) {
  const { setUser, ready } = useAuth()
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('CANDIDATE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [retryAt, setRetryAt] = useState(0)
  const [rateLimited, setRateLimited] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!setUser || !ready || busy || Date.now() < retryAt) return
    setBusy(true)
    setError('')
    setFields({})
    try {
      const { data } = await api<{ user: ApiUser }>(signup ? '/auth/signup' : '/auth/login', {
        method: 'POST',
        body: JSON.stringify(signup ? { email, password, name, role } : { email, password }),
      })
      const user = setUser(data.user)
      const from = new URLSearchParams(window.location.search).get('next')
      const destination = home(user.role)
      let next = destination
      if (from?.startsWith(destination + '/')) {
        const target = new URL(from, window.location.origin)
        if (target.origin === window.location.origin && target.pathname.startsWith(destination + '/'))
          next = target.pathname + target.search
      }
      router.replace(next)
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFields(Object.fromEntries(cause.details?.map(({ path, message }) => [path, message]) ?? []))
        if (cause.retryAfter) {
          const delay = Math.min(cause.retryAfter * 1000, 2_147_483_647)
          setRetryAt(Date.now() + delay)
          setRateLimited(true)
          window.setTimeout(() => setRateLimited(false), delay)
          setError(cause.message + ' Try again in ' + cause.retryAfter + ' seconds.')
        } else setError(cause.message)
      } else setError('Could not reach the examination service. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicCard title={signup ? 'Create account' : 'Sign in'} subtitle="Access your examination workspace.">
      <form onSubmit={submit}>
        {signup && (
          <>
            <Field label="Full name">
              <input value={name} required maxLength={120} autoComplete="name"
                onChange={(event) => setName(event.target.value)} />
              {fields.name && <small className="danger">{fields.name}</small>}
            </Field>
            <Field label="Account role">
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="CANDIDATE">Candidate</option>
                <option value="EXAMINER">Examiner</option>
              </select>
              {fields.role && <small className="danger">{fields.role}</small>}
            </Field>
          </>
        )}
        <Field label="Email address">
          <input type="email" value={email} required maxLength={254} autoComplete="email"
            onChange={(event) => setEmail(event.target.value)} />
          {fields.email && <small className="danger">{fields.email}</small>}
        </Field>
        <Password value={password} set={setPassword} />
        {fields.password && <small className="danger">{fields.password}</small>}
        {error && <p role="alert" className="danger">{error}</p>}
        <div className="actions">
          <Button type="submit" disabled={!ready || busy || rateLimited}>
            {signup ? 'Create account' : 'Sign in'}
          </Button>
          <Link href={signup ? '/login' : '/signup'}>
            {signup ? 'Sign in' : 'Create an account'}
          </Link>
        </div>
      </form>
    </PublicCard>
  )
}
