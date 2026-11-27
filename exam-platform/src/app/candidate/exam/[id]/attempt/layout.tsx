import { AttemptGuard } from '@/components/auth/RoleGuard'
import { Suspense, type ReactNode } from 'react'

export default function AttemptLayout({ children }: { children: ReactNode }) {
  return (
    <div className="focus-layout">
      <Suspense fallback={<p className="route-status">Loading examination…</p>}>
        <AttemptGuard>{children}</AttemptGuard>
      </Suspense>
    </div>
  )
}
