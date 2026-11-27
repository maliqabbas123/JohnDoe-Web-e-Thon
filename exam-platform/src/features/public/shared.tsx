'use client'

import {
  BookOpen,
  Clock3,
  Eye,
  EyeOff,
  FileCheck2,
  GraduationCap,
  ScanLine,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, Field, Heading, Panel } from '../../components/shared'
import { useStore } from '../../context/MockStoreContext'

function Lookup({ initial = '' }: { initial?: string }) {
  const [code, set] = useState(initial),
    router = useRouter()
  return (
    <form
      className="lookup"
      onSubmit={(e) => {
        e.preventDefault()
        if (code.trim())
          router.push(
            '/verify/' + encodeURIComponent(code.trim().toUpperCase()),
          )
      }}
    >
      <label className="search">
        <ScanLine size={18} />
        <input
          aria-label="Verification code"
          required
          placeholder="e.g. CERT-2026-8841"
          value={code}
          onChange={(e) => set(e.target.value)}
        />
      </label>
      <Button type="submit">Verify result</Button>
    </form>
  )
}

const demos = [
  {
    role: 'Administrator',
    label: 'Admin',
    id: 'u1',
    Icon: Users,
    body: 'Manage users, set platform policies, and oversee examinations.',
    color: 'purple',
  },
  {
    role: 'Examiner',
    label: 'Examiner',
    id: 'u2',
    Icon: BookOpen,
    body: 'Build exams, monitor live sessions, and publish results.',
    color: 'blue',
  },
  {
    role: 'Candidate',
    label: 'Candidate',
    id: 'u3',
    Icon: GraduationCap,
    body: 'Take examinations, review results, and track appeals.',
    color: 'green',
  },
] as const

const features = [
  {
    Icon: BookOpen,
    title: 'Build your examinations',
    description:
      'Create a question bank, assemble papers, and preview each exam before publishing.',
  },
  {
    Icon: Clock3,
    title: 'Run timed assessments',
    description:
      'Give candidates a focused workspace with a countdown, saved answers, and a recovery path.',
  },
  {
    Icon: FileCheck2,
    title: 'Publish verifiable results',
    description:
      'Review grades before release and issue scorecards with a public verification code.',
  },
]

function PublicCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <main className="public-card">
      <Panel>
        <span className="feature-icon purple">
          <ShieldCheck size={24} />
        </span>
        <Heading title={title} subtitle={subtitle} />
        {children}
      </Panel>
    </main>
  )
}

function Password({
  value,
  set,
  label = 'Password',
}: {
  value: string
  set: (v: string) => void
  label?: string
}) {
  const [visible, show] = useState(false)
  return (
    <Field label={label}>
      <div className="password">
        <input
          required
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => set(e.target.value)}
        />
        <button
          type="button"
          className="icon"
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => show(!visible)}
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </div>
    </Field>
  )
}

function AccountPassword({ purpose }: { purpose: 'invite' | 'reset' }) {
  const { token } = useParams<{ token: string }>(),
    { state, update, toast } = useStore(),
    router = useRouter(),
    [password, set] = useState(''),
    [confirm, setConfirm] = useState(''),
    [error, setError] = useState('')
  const grant = state.tokens[token ?? ''],
    u = state.users.find((u) => u.id === grant?.user),
    strong =
      password.length >= state.policy.password &&
      /[0-9]/.test(password) &&
      /[A-Za-z]/.test(password)
  return (
    <PublicCard
      title={
        purpose === 'invite' ? 'Activate your account' : 'Set a new password'
      }
    >
      {grant?.purpose !== purpose || !u ? (
        <>
          <p>This link is invalid or has already been used.</p>
          <Button to="/forgot-password">Request a new reset link</Button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!strong || password !== confirm) {
              setError(
                'Check the password requirements and confirm your password.',
              )
              return
            }
            update((s) => {
              const user = s.users.find((x) => x.id === u.id)!
              user.password = password
              if (purpose === 'invite') user.active = true
              delete s.tokens[token!]
            })
            toast('Password saved.')
            router.push('/login')
          }}
        >
          {purpose === 'invite' && (
            <p>
              <strong>{u.email}</strong> · {u.role}
            </p>
          )}
          <Password label="New password" value={password} set={set} />
          <p>
            <Badge>
              {strong ? 'Strong password' : 'Password requirements'}
            </Badge>{' '}
            {state.policy.password}+ characters with a letter and a number.
          </p>
          <Password label="Confirm password" value={confirm} set={setConfirm} />
          {error && (
            <p role="alert" className="danger">
              {error}
            </p>
          )}
          <Button type="submit">Save password</Button>
        </form>
      )}
    </PublicCard>
  )
}

export { AccountPassword, demos, features, Lookup, Password, PublicCard }
