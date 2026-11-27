'use client'

import {
  Badge,
  Button,
  DataTable,
  Panel,
  Stats,
  Tabs,
} from '../../components/shared'
import { finalScore, score, serverNow } from '../../context/MockStoreContext'

import { Cohort, ExamHeader, Missing, pending, useExam } from './shared'

export function ExamResultsHubPage() {
  const { exam, state, attempts, base, update, toast } = useExam()
  if (!exam) return <Missing />
  const submitted = attempts.filter((a) => a.submitted && !a.pending),
    queue = submitted.filter((a) => pending(exam, a, state.questions)),
    syncing = attempts.filter((a) => a.pending).length,
    ready =
      exam.status === 'Completed' &&
      submitted.length > 0 &&
      !queue.length &&
      !syncing
  return (
    <>
      <ExamHeader exam={exam} title="Results and evaluation" />
      <Panel>
        <Tabs
          labels={[
            'Submissions & grading',
            'Controlled publication',
            'Cohort analytics',
          ]}
        >
          {(i) =>
            i === 0 ? (
              <DataTable
                columns={[
                  'Candidate',
                  'Objective score',
                  'Written grading',
                  'Total',
                  'Action',
                ]}
                filters={{ Status: ['Pending', 'Graded'] }}
                rows={submitted.map((a) => {
                  const name =
                      state.users.find((u) => u.id === a.user)?.name ?? '',
                    status = pending(exam, a, state.questions)
                      ? 'Pending'
                      : 'Graded'
                  return {
                    key: a.id,
                    search: name,
                    filters: { Status: status },
                    cells: [
                      name,
                      score(
                        exam,
                        { ...a, grades: {} },
                        state.questions,
                      ).toFixed(1),
                      <Badge>{status}</Badge>,
                      finalScore(exam, a, state.questions).toFixed(1) +
                        ' / ' +
                        exam.total,
                      <Button secondary to={base + '/submissions/' + a.id}>
                        Open grading
                      </Button>,
                    ],
                  }
                })}
              />
            ) : i === 1 ? (
              <>
                <h2>Publication audit</h2>
                <Stats
                  items={[
                    ['Synced submissions', submitted.length],
                    ['Pending written grading', queue.length],
                    ['Pending sync', syncing],
                    ['Examination state', exam.status],
                  ]}
                />
                <p>
                  Complete the examination and grade all synced submissions
                  before releasing results.
                </p>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={exam.released}
                    disabled={!ready && !exam.released}
                    onChange={(e) => {
                      const value = e.target.checked
                      update((s) => {
                        s.exams.find((x) => x.id === exam.id)!.released = value
                        s.audit.unshift({
                          at: serverNow(),
                          type: 'Results',
                          message:
                            exam.title +
                            (value
                              ? ' results published'
                              : ' results withdrawn'),
                        })
                      })
                      toast(value ? 'Results published.' : 'Results withdrawn.')
                    }}
                  />{' '}
                  Publish results
                </label>
              </>
            ) : (
              <>
                <Cohort
                  points={submitted.map((a) =>
                    finalScore(exam, a, state.questions),
                  )}
                  total={exam.total}
                />
                <Button to={base + '/reports'}>Cohort PDF reports</Button>
              </>
            )
          }
        </Tabs>
      </Panel>
    </>
  )
}
