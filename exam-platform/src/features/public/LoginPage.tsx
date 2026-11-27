'use client'

import Link from 'next/link'
import { LiveAccountForm } from './LiveAccountForm'
import { isLive } from '@/lib/api'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button, Field } from '../../components/shared'
import { home, useStore } from '../../context/MockStoreContext'

import { Password, PublicCard } from './shared'

export function LoginPage() {
  return isLive ? <LiveAccountForm /> : <DemoLoginPage />
}

function DemoLoginPage() {
  const { state, login } = useStore(),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    router = useRouter()
  function submit(e: FormEvent) {
    e.preventDefault()
    const user = state.users.find(
      (u) =>
        u.email.toLowerCase() === email.trim().toLowerCase() &&
        u.password === password &&
        u.active,
    )
    if (!user) {
      setError(
        'The email or password is incorrect, or the account is inactive.',
      )
      return
    }
    login(user.id)
    const from = new URLSearchParams(window.location.search).get('next')
    router.replace(
      from?.startsWith('/') && !from.startsWith('//') && !from.includes('\\')
        ? from
        : home(user.role),
    )
  }
  return (
    <PublicCard title="Sign in" subtitle="Access your examination workspace.">
      <form onSubmit={submit}>
        <Field label="Email address">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Password value={password} set={setPassword} />
        {error && (
          <p role="alert" className="danger">
            {error}
          </p>
        )}
        <div className="actions">
          <Button type="submit">Sign in</Button>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </PublicCard>
  )
}
