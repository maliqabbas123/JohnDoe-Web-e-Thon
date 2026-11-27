import { Suspense } from 'react'
import { AdminAuditLogPage } from '@/features/admin/AdminAuditLogPage'

export default function AuditLogPage() {
  return (
    <Suspense fallback={<p role="status">Loading audit log…</p>}>
      <AdminAuditLogPage />
    </Suspense>
  )
}
