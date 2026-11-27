'use client'

import { useState } from 'react'
import { Button, DataTable, Panel } from '../../components/shared'
import { date, finalScore, id, serverNow } from '../../context/MockStoreContext'
import { downloadCohortReport, reportStats } from './cohortReport'
import { ExamHeader, Missing, pending, useExam } from './shared'
import type { CohortReport } from '../../types'

export function ExamReportsPage() {
  const { exam, attempts, state, update, toast, base } = useExam()
  const [busy, setBusy] = useState(false)
  if (!exam) return <Missing />

  const submissions = attempts.filter(
    (attempt) => attempt.submitted && !attempt.pending,
  )
  const pendingGrades = submissions.some((attempt) =>
    pending(exam, attempt, state.questions),
  )
  const canGenerate = submissions.length > 0 && !pendingGrades
  const reports = (state.cohortReports ?? []).filter(
    (report) => report.exam === exam.id,
  )

  async function download(report: CohortReport) {
    setBusy(true)
    try {
      await downloadCohortReport(report)
      return true
    } catch {
      toast('The PDF could not be generated. Try downloading it again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function generate() {
    if (!exam || !canGenerate || busy) return
    const report = {
      id: id(),
      exam: exam.id,
      title: exam.title,
      generatedAt: serverNow(),
      total: exam.total,
      scores: submissions.map((attempt) => ({
        name:
          state.users.find((user) => user.id === attempt.user)?.name ??
          'Unknown candidate',
        points: finalScore(exam, attempt, state.questions),
      })),
    }
    if (await download(report)) {
      update((draft) => {
        draft.cohortReports ??= []
        draft.cohortReports.unshift(report)
      })
      toast('Report saved to history.')
    }
  }

  return (
    <>
      <ExamHeader
        exam={exam}
        title="Cohort reports"
        actions={
          <Button secondary to={base + '/results'}>
            Results
          </Button>
        }
      />
      <Panel title="Generate a PDF">
        <p>
          Each PDF preserves the synced scores and cohort statistics from the
          time it was generated.
        </p>
        {!canGenerate && (
          <p>
            {pendingGrades
              ? 'Finish grading the synced submissions to generate a report.'
              : 'A synced submission is required to generate a report.'}
          </p>
        )}
        <Button disabled={!canGenerate || busy} onClick={() => void generate()}>
          Generate and download PDF
        </Button>
      </Panel>
      <Panel title="Report history">
        {reports.length === 0 ? (
          <p>No reports generated yet.</p>
        ) : (
          <DataTable
            columns={['Generated', 'Submissions', 'Mean score', 'Action']}
            rows={reports.map((report) => {
              const stats = reportStats(report)
              return {
                key: report.id,
                search: date(report.generatedAt) + ' ' + report.title,
                cells: [
                  date(report.generatedAt),
                  stats.count,
                  stats.average.toFixed(1) + ' / ' + report.total,
                  <Button
                    secondary
                    disabled={busy}
                    onClick={() => void download(report)}
                  >
                    Download PDF
                  </Button>,
                ],
              }
            })}
          />
        )}
      </Panel>
    </>
  )
}
