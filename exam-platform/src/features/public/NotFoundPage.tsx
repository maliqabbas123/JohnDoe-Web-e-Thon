'use client'

import { Button } from '../../components/shared'

import { PublicCard } from './shared'

export function NotFoundPage() {
  return (
    <PublicCard
      title="404 Page not found"
      subtitle="Check the address or return to the home page."
    >
      <Button to="/">Return home</Button>
    </PublicCard>
  )
}
