'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Button, Field } from '../../components/shared'
import { id, useStore } from '../../context/MockStoreContext'

import { PublicCard } from './shared'

export function ForgotPasswordPage() {
  const { state, update } = useStore(),
    [email, set] = useState(''),
    [sent, done] = useState(false),
    [token, setToken] = useState('')
  return (
    <PublicCard
      title="Reset your password"
      subtitle="Enter the email address associated with your account."
    >
      {sent ? (
        <div role="status">
          <p>If an active account matches, a reset link has been created.</p>
          {token && (
            <Link href={'/reset-password/' + token}>Open demo reset link</Link>
          )}
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const u = state.users.find(
              (u) =>
                u.email.toLowerCase() === email.trim().toLowerCase() &&
                u.active,
            )
            if (u) {
              const token = id()
              update((s) => {
                s.tokens[token] = { user: u.id, purpose: 'reset' }
              })
              setToken(token)
            }
            done(true)
          }}
        >
          <Field label="Email address">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => set(e.target.value)}
            />
          </Field>
          <Button type="submit">Request reset</Button>
        </form>
      )}
    </PublicCard>
  )
}
