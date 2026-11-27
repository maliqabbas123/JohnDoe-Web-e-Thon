'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, ApiError, sessionExpiredEvent } from '@/lib/api'
import { useStore } from './MockStoreContext'
import type { Role } from '@/types'

const displayRoles = {
  ADMIN: 'Administrator',
  EXAMINER: 'Examiner',
  CANDIDATE: 'Candidate',
} as const

type ApiUser = { id: string; name: string; email: string; role: keyof typeof displayRoles }
type SessionUser = Omit<ApiUser, 'role'> & { role: Role }
type Session = {
  user?: SessionUser
  ready: boolean
  error?: string
  refresh?: () => Promise<void>
  logout: () => Promise<void>
  setUser?: (user: ApiUser) => SessionUser
}

const AuthContext = createContext<Session | null>(null)

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error('Auth provider is missing')
  return auth
}

export function DemoAuthProvider({ children }: { children: ReactNode }) {
  const { user, ready, logout } = useStore()
  return (
    <AuthContext.Provider value={{ user, ready, logout: async () => logout() }}>
      {children}
    </AuthContext.Provider>
  )
}

export function LiveAuthProvider({ children }: { children: ReactNode }) {
  const [user, setSession] = useState<SessionUser>()
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string>()
  const setUser = useCallback((account: ApiUser) => {
    const current = { ...account, role: displayRoles[account.role] }
    setSession(current)
    setError(undefined)
    return current
  }, [])
  const refresh = useCallback(async () => {
    setReady(false)
    setError(undefined)
    try {
      const { data } = await api<ApiUser>('/auth/me')
      setUser(data)
    } catch (cause) {
      setSession(undefined)
      if (!(cause instanceof ApiError && cause.status === 401))
        setError('Could not check your session. Check your connection and try again.')
    } finally {
      setReady(true)
    }
  }, [setUser])
  useEffect(() => {
    const expire = () => setSession(undefined)
    window.addEventListener(sessionExpiredEvent, expire)
    void refresh()
    return () => window.removeEventListener(sessionExpiredEvent, expire)
  }, [refresh])

  async function logout() {
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401)) throw cause
    }
    setSession(undefined)
  }

  return (
    <AuthContext.Provider value={{ user, ready, error, refresh, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export type { ApiUser }
