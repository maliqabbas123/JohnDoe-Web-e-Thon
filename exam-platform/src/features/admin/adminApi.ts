import type { Role } from '@/types'

export type AccountRole = 'ADMIN' | 'EXAMINER' | 'CANDIDATE'

export const accountRoles: Record<AccountRole, Role> = {
  ADMIN: 'Administrator',
  EXAMINER: 'Examiner',
  CANDIDATE: 'Candidate',
}

export type Account = {
  id: string
  name: string
  email: string
  role: AccountRole
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type Overview = {
  serverTime: string
  users: { total: number; active: number; inactive: number }
  exams: {
    draft: number
    published: number
    upcoming: number
    ongoing: number
    completed: number
  }
  attempts: {
    inProgress: number
    interrupted: number
    submitted: number
    expired: number
  }
  disputes: { open: number }
  sessions: { active: number }
  security: { failedSignInsLast24Hours: number }
}

export type AccountChange = {
  id: string
  action: string
  actor: Pick<Account, 'id' | 'name' | 'email' | 'role'> | null
  metadata: Record<string, unknown> | null
  ip: string | null
  createdAt: string
}

export type AuditEntry = AccountChange & {
  entityType: string
  entityId: string | null
}

export type AccountActivity = {
  sessions: {
    id: string
    createdAt: string
    lastSeenAt: string
    expiresAt: string
    ip: string | null
    userAgent: string | null
  }[]
  signInLock: { locked: boolean; until: string | null }
  signIns: {
    id: string
    succeeded: boolean
    ip: string | null
    createdAt: string
  }[]
  accountChanges: AccountChange[]
}

export const accountPath = (id: string) => '/users/' + encodeURIComponent(id)
export const accountHref = (id: string) => '/admin' + accountPath(id)

export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export const formatTime = (value: string) => dateFormat.format(new Date(value))

export const formatAction = (value: string) =>
  value.charAt(0).toUpperCase() +
  value.slice(1).toLowerCase().replaceAll('_', ' ')
