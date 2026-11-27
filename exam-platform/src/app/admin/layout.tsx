import { RoleGuard } from '@/components/auth/RoleGuard'
import { DashboardShell } from '@/components/layouts'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard roles={['Administrator']}>
      <DashboardShell>{children}</DashboardShell>
    </RoleGuard>
  )
}
