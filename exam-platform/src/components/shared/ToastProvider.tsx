'use client'

import type { ReactNode } from 'react'
import { ToastNotification } from '.'
import { useStore } from '../../context/MockStoreContext'

export function ToastProvider({ children }: { children: ReactNode }) {
  const { notice } = useStore()
  return (
    <>
      {children}
      <ToastNotification message={notice} />
    </>
  )
}
