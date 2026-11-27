import { LiveAccountForm } from '@/features/public/LiveAccountForm'
import { isLive } from '@/lib/api'
import { notFound } from 'next/navigation'

export default function SignupPage() {
  if (!isLive) notFound()
  return <LiveAccountForm signup />
}
