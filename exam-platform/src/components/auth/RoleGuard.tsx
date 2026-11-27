'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { useStore } from '../../context/MockStoreContext'
import type { Role } from '../../types'

export function ClientRedirect({ href }: { href: string }) {
  const router = useRouter()
  useEffect(() => {
    router.replace(href)
  }, [router, href])
  return (
    <p className="route-status" role="status">
      Opening workspace…
    </p>
  )
}

export function RoleGuard({
  roles,
  children,
  query = '',
}: {
  roles: Role[]
  children: ReactNode
  query?: string
}) {
  const { ready, user } = useStore()
  const pathname = usePathname()
  if (!ready)
    return (
      <p className="route-status" role="status">
        Loading workspace…
      </p>
    )
  if (!user)
    return (
      <ClientRedirect
        href={'/login?next=' + encodeURIComponent(pathname + query)}
      />
    )
  if (!roles.includes(user.role)) return <ClientRedirect href="/unauthorized" />
  return children
}

export function AttemptGuard({ children }: { children: ReactNode }) {
  const sandbox = useSearchParams().get('sandbox') === 'true'
  return (
    <RoleGuard
      roles={sandbox ? ['Examiner'] : ['Candidate']}
      query={sandbox ? '?sandbox=true' : ''}
    >
      {children}
    </RoleGuard>
  )
}
