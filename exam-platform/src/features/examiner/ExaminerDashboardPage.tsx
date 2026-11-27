'use client'

import { isLive } from '@/lib/api'
import { LiveExamDirectory } from './LiveExamDirectory'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  DataTable,
  Heading,
  Panel,
  Stats,
} from '../../components/shared'
import {
  date,
  id,
  iso,
  serverNow,
  useStore,
} from '../../context/MockStoreContext'

import { ep, pending, sandbox, statuses } from './shared'

function DemoExaminerDashboardPage() {
  const { state, user, update } = useStore(),
    router = useRouter(),
    exams = state.exams.filter((e) => e.owner === user?.id)
  return (
    <>
      <Heading
        title="My examinations"
        subtitle="Build assessments, monitor sittings, and release results."
        actions={
          <Button
            onClick={() => {
              const eid = id()
              update((s) =>
                s.exams.push({
                  id: eid,
                  owner: user!.id,
                  title: 'Untitled examination',
                  subject: 'General',
                  status: 'Draft',
                  date: iso(serverNow() + 86400000),
                  close: iso(serverNow() + 172800000),
                  duration: 60,
                  total: 20,
                  instructions:
                    'Read each question carefully before submitting.',
                  shuffle: false,
                  shuffleOptions: false,
                  paper: [],
                  candidates: [],
                  released: false,
                  blueprint: { Easy: 25, Medium: 50, Hard: 25 },
                  normalization: 0,
                }),
              )
              router.push(ep(eid) + '/setup')
            }}
          >
            Create examination
          </Button>
        }
      />
      <Stats
        items={[
          ...statuses.map(
            (s) =>
              [s, exams.filter((e) => e.status === s).length] as [
                string,
                number,
              ],
          ),
          [
            'Pending grading',
            state.attempts.filter(
              (a) =>
                a.submitted &&
                !a.pending &&
                exams.some(
                  (e) => e.id === a.exam && pending(e, a, state.questions),
                ),
            ).length,
          ],
        ]}
      />
      <Panel title="Examination directory">
        <DataTable
          columns={[
            'Examination',
            'Status',
            'Availability',
            'Candidates',
            'Actions',
          ]}
          filters={{ Status: statuses }}
          rows={exams.map((e) => ({
            key: e.id,
            search: e.title + ' ' + e.subject,
            filters: { Status: e.status },
            cells: [
              <Link href={ep(e.id) + '/setup'}>
                {e.title}
                <small>{e.subject}</small>
              </Link>,
              <Badge>{e.status}</Badge>,
              date(e.date),
              e.candidates.length,
              <div className="actions">
                <Link href={ep(e.id) + '/setup'}>Setup</Link>
                <Link href={sandbox(e.id)}>Sandbox</Link>
                {e.status === 'Ongoing' && (
                  <Link href={ep(e.id) + '/live'}>Live monitor</Link>
                )}
                {e.status === 'Completed' && (
                  <Link href={ep(e.id) + '/results'}>Results</Link>
                )}
              </div>,
            ],
          }))}
        />
      </Panel>
    </>
  )
}

export function ExaminerDashboardPage() {
  return isLive ? <LiveExamDirectory /> : <DemoExaminerDashboardPage />
}
