import { ToastProvider } from '@/components/shared/ToastProvider'
import { MockStoreProvider } from '@/context/MockStoreContext'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: 'Proctorate | Examination Management',
  description: 'Create, deliver, and verify examinations in one workspace.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <MockStoreProvider>
          <ToastProvider>{children}</ToastProvider>
        </MockStoreProvider>
      </body>
    </html>
  )
}
