'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { isLiveDashboardRoute } from '@/lib/liveRoutes'

const tools = [
  ['setup', 'Setup'],
  ['blueprint', 'Paper blueprint'],
  ['enrolment', 'Enrolment and retakes'],
  ['live', 'Live monitor'],
  ['grading', 'Grading'],
] as const

export type ExamTool = (typeof tools)[number][0]

// Tool links for one examination. Only tools with a live page are shown.
export function LiveExamNav({
  id,
  current,
  children,
}: {
  id: string
  current?: ExamTool
  children?: ReactNode
}) {
  const page = '/examiner/exams/' + encodeURIComponent(id)
  return (
    <nav className="exam-nav" aria-label="Examination tools">
      {tools
        .filter(([path]) => isLiveDashboardRoute(page + '/' + path))
        .map(([path, label]) => (
          <Link
            key={path}
            href={page + '/' + path}
            aria-current={current === path ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      {children}
    </nav>
  )
}
