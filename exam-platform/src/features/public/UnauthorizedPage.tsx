'use client'

import { Button } from '../../components/shared'
import { home } from '../../context/MockStoreContext'
import { useAuth } from '@/context/AuthContext'

import { PublicCard } from './shared'

export function UnauthorizedPage() {
  const { user } = useAuth()
  return (
    <PublicCard
      title="403 Access denied"
      subtitle="Your current role does not have access to this page."
    >
      <Button to={home(user?.role)}>Return to dashboard</Button>
    </PublicCard>
  )
}
