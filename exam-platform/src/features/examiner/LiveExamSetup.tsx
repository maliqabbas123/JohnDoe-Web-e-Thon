'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge, Button, Heading, Panel, Stats } from '@/components/shared'
import { ApiError, api } from '@/lib/api'
import { LiveExamDifficultyRules, LiveExamPaper } from './LiveExamPaper'
import { LiveExamSettings } from './LiveExamSettings'
import {
  examApiPath,
  examDifficultyLabels,
  examErrorDetails,
  examErrorMessage,
  examPagePath,
  examStates,
  type ExamDetail,
  type ExamDifficultyRule,
  type ExamIssue,
  type ExamPoolRow,
  type ExamReview,
  type ExamSummary,
} from './examApi'

function IssueList({ issues }: { issues: ExamIssue[] }) {
  return (
    <ul>
      {issues.map((issue) => (
        <li key={issue.path + issue.message}>{issue.message}</li>
      ))}
    </ul>
  )
}

function ReviewPanel({
  review,
  disabled,
  check,
  publish,
}: {
  review: ExamReview | null
  disabled: boolean
  check: () => void
  publish: () => void
}) {
  return (
    <Panel title="Publication review">
      {review && (
        <>
          <Stats
            items={[
              ['Questions per paper', review.questionCount ?? 'Pending'],
              ['Paper marks', review.paperMarks ?? 'Pending'],
              [
                'Publication status',
                review.canPublish ? 'Ready' : 'Action required',
              ],
            ]}
          />
          {!!review.errors.length && (
            <div className="danger">
              <h3>Fix before publishing</h3>
              <IssueList issues={review.errors} />
            </div>
          )}
          {!!review.warnings.length && (
            <div>
              <h3>Warnings</h3>
              <IssueList issues={review.warnings} />
            </div>
          )}
          {!!review.difficulty.length && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Difficulty</th>
                    <th scope="col">Required</th>
                    <th scope="col">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {review.difficulty.map((entry) => (
                    <tr key={entry.difficulty}>
                      <th scope="row">
                        {examDifficultyLabels[entry.difficulty]}
                      </th>
                      <td>{entry.required}</td>
                      <td>{entry.available}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <div className="actions">
        <Button secondary onClick={check} disabled={disabled}>
          Check readiness
        </Button>
        <Button onClick={publish} disabled={disabled || !review?.canPublish}>
          Publish examination
        </Button>
      </div>
    </Panel>
  )
}

function ExamSetupEditor({
  initialExam,
  paperFirst,
  reload,
}: {
  initialExam: ExamDetail
  paperFirst: boolean
  reload: () => void
}) {
  const [exam, setExam] = useState(initialExam)
  const [settingsDirty, setSettingsDirty] = useState(false)
  const [poolDirty, setPoolDirty] = useState(false)
  const [rulesDirty, setRulesDirty] = useState(false)
  const [review, setReview] = useState<ExamReview | null>(null)
  const [busy, setBusy] = useState(false)
  const actionPending = useRef(false)
  const [feedback, setFeedback] = useState<{
    error: string
    details: ExamIssue[]
    canReload: boolean
  } | null>(null)
  const [notice, setNotice] = useState('')
  const endpoint = examApiPath(exam.id)
  const page = examPagePath(exam.id)
  const paperLocked = exam.state === 'ONGOING' || exam.state === 'COMPLETED'
  const dirty = settingsDirty || poolDirty || rulesDirty

  async function act<T>(action: () => Promise<T>, done?: string) {
    if (actionPending.current) return undefined
    actionPending.current = true
    setBusy(true)
    setFeedback(null)
    setNotice('')
    try {
      const value = await action()
      if (done) setNotice(done)
      return value
    } catch (error) {
      setFeedback({
        error: examErrorMessage(error),
        details: examErrorDetails(error),
        canReload: error instanceof ApiError && error.status === 409,
      })
      return undefined
    } finally {
      actionPending.current = false
      setBusy(false)
    }
  }

  function saveSettings(payload: object) {
    return act(async () => {
      const { data } = await api<ExamDetail>(endpoint, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      })
      setExam(data)
      setReview(null)
      if (data.selectionMode !== exam.selectionMode) {
        setPoolDirty(false)
        setRulesDirty(false)
      }
      return data
    }, 'Settings saved.')
  }

  function savePool(questions: { questionId: string; marks?: number }[]) {
    return act(async () => {
      const { data } = await api<{ questions: ExamPoolRow[] }>(
        endpoint + '/questions',
        {
          method: 'PUT',
          body: JSON.stringify({ questions }),
        },
      )
      setExam((current) => ({ ...current, questions: data.questions }))
      setReview(null)
      return data.questions
    }, 'Paper saved.')
  }

  function saveRules(payload: {
    questionCount: number
    rules: ExamDifficultyRule[]
  }) {
    return act(async () => {
      const { data } = await api<
        Pick<ExamDetail, 'questionCount' | 'difficultyRules'>
      >(endpoint + '/difficulty-rules', {
        method: 'PUT',
        body: JSON.stringify(payload),
      })
      setExam((current) => ({ ...current, ...data }))
      setReview(null)
      return data
    }, 'Difficulty rules saved.')
  }

  function checkReview() {
    setReview(null)
    return act(async () => {
      const { data } = await api<ExamReview>(endpoint + '/review')
      setReview(data)
    })
  }

  function lifecycle(
    action: 'publish' | 'unpublish' | 'complete',
    message: string,
  ) {
    setReview(null)
    return act(async () => {
      const { data } = await api<ExamSummary>(endpoint + '/' + action, {
        method: 'POST',
      })
      setExam((current) => ({ ...current, ...data }))
    }, message)
  }

  function setJoinCode(method: 'POST' | 'DELETE') {
    return act(
      async () => {
        if (method === 'DELETE') {
          await api<void>(endpoint + '/join-code', { method })
          setExam((current) => ({ ...current, joinCode: null }))
        } else {
          const { data } = await api<{ joinCode: string }>(
            endpoint + '/join-code',
            { method },
          )
          setExam((current) => ({ ...current, joinCode: data.joinCode }))
        }
      },
      method === 'DELETE' ? 'Join code disabled.' : 'Join code generated.',
    )
  }

  function settings(): ReactNode {
    return (
      <LiveExamSettings
        exam={exam}
        busy={busy}
        paperDirty={poolDirty || rulesDirty}
        onDirtyChange={setSettingsDirty}
        save={saveSettings}
      />
    )
  }

  function paper(): ReactNode {
    return (
      <section id="exam-paper">
        {settingsDirty && !paperLocked && (
          <p role="status">
            Save or discard settings changes before editing the paper.
          </p>
        )}
        <LiveExamPaper
          key={exam.selectionMode}
          exam={exam}
          disabled={busy || paperLocked || settingsDirty}
          onDirtyChange={setPoolDirty}
          save={savePool}
        />
        {exam.selectionMode === 'BALANCED' && (
          <LiveExamDifficultyRules
            exam={exam}
            disabled={busy || paperLocked || settingsDirty}
            onDirtyChange={setRulesDirty}
            save={saveRules}
          />
        )}
      </section>
    )
  }

  return (
    <>
      <Heading
        title={paperFirst ? 'Paper blueprint' : 'Examination setup'}
        subtitle={exam.title}
        actions={
          <>
            <Badge>{examStates[exam.state]}</Badge>
            <Button secondary to="/examiner">
              My examinations
            </Button>
          </>
        }
      />
      <nav className="exam-nav" aria-label="Examination tools">
        <Link
          href={page + '/setup'}
          aria-current={paperFirst ? undefined : 'page'}
        >
          Setup
        </Link>
        <Link
          href={page + '/blueprint'}
          aria-current={paperFirst ? 'page' : undefined}
        >
          Paper blueprint
        </Link>
        <a href="#exam-review">Review and publication</a>
        <Link href={page + '/enrolment'}>Enrolment and retakes</Link>
      </nav>
      {feedback && (
        <Panel>
          <div className="danger" role="alert">
            <p>{feedback.error}</p>
            {!!feedback.details.length && (
              <IssueList issues={feedback.details} />
            )}
          </div>
          {feedback.canReload && (
            <Button
              secondary
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm(
                    'Discard unsaved changes and reload the examination?',
                  )
                )
                  reload()
              }}
            >
              Reload examination
            </Button>
          )}
        </Panel>
      )}
      {notice && <p role="status">{notice}</p>}
      {busy && <p role="status">Updating examination…</p>}
      {paperFirst ? (
        <>
          {paper()}
          {settings()}
        </>
      ) : (
        <>
          {settings()}
          {paper()}
        </>
      )}
      <section id="exam-review">
        {dirty && (
          <p role="status">
            Save your changes before reviewing or changing the examination
            status.
          </p>
        )}
        {exam.status === 'DRAFT' && (
          <ReviewPanel
            review={review}
            disabled={busy || dirty}
            check={checkReview}
            publish={() => lifecycle('publish', 'Examination published.')}
          />
        )}
        {exam.status === 'PUBLISHED' && (
          <Panel title="Examination status">
            <div className="actions">
              {exam.state === 'PUBLISHED' && (
                <Button
                  secondary
                  disabled={busy || dirty}
                  onClick={() =>
                    lifecycle('unpublish', 'Examination returned to draft.')
                  }
                >
                  Return to draft
                </Button>
              )}
              <Button
                secondary
                disabled={busy || dirty}
                onClick={() => {
                  if (
                    window.confirm(
                      'Close this examination? Candidates will no longer be able to start the main sitting.',
                    )
                  ) {
                    void lifecycle('complete', 'Examination closed.')
                  }
                }}
              >
                Close examination
              </Button>
            </div>
          </Panel>
        )}
        <Panel title="Candidate-facing rules">
          {exam.rules.statements.length ? (
            <ul>
              {exam.rules.statements.map((statement) => (
                <li key={statement}>{statement}</li>
              ))}
            </ul>
          ) : (
            <p>No workspace rules enabled.</p>
          )}
        </Panel>
        <Panel title="Candidate join code">
          {exam.joinCode ? (
            <p>
              <code>{exam.joinCode}</code>
            </p>
          ) : (
            <p>No active join code.</p>
          )}
          <div className="actions">
            <Button
              secondary
              disabled={busy}
              onClick={() => {
                if (
                  !exam.joinCode ||
                  window.confirm(
                    'Replace the join code? The current code will stop working.',
                  )
                )
                  void setJoinCode('POST')
              }}
            >
              {exam.joinCode ? 'Replace code' : 'Generate code'}
            </Button>
            {exam.joinCode && (
              <Button
                secondary
                disabled={busy}
                onClick={() => {
                  if (
                    window.confirm(
                      'Disable the join code? Existing enrolments will be kept.',
                    )
                  )
                    void setJoinCode('DELETE')
                }}
              >
                Disable code
              </Button>
            )}
          </div>
        </Panel>
      </section>
    </>
  )
}

function ExamSetupLoader({
  id,
  paperFirst,
}: {
  id: string
  paperFirst: boolean
}) {
  const [exam, setExam] = useState<ExamDetail | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    api<ExamDetail>(examApiPath(id), { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setExam(data)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(examErrorMessage(error))
      })
    return () => controller.abort()
  }, [id, retry])

  function reload() {
    setExam(null)
    setRetry((count) => count + 1)
  }

  if (exam)
    return (
      <ExamSetupEditor
        initialExam={exam}
        paperFirst={paperFirst}
        reload={reload}
      />
    )
  return (
    <Panel>
      <Heading title={paperFirst ? 'Paper blueprint' : 'Examination setup'} />
      {error ? (
        <>
          <p className="danger" role="alert">
            {error}
          </p>
          <div className="actions">
            <Button secondary to="/examiner">
              My examinations
            </Button>
            <Button onClick={() => setRetry(retry + 1)}>Retry</Button>
          </div>
        </>
      ) : (
        <p role="status">Loading examination…</p>
      )}
    </Panel>
  )
}

export function LiveExamSetup({
  paperFirst = false,
}: {
  paperFirst?: boolean
}) {
  const { id } = useParams<{ id: string }>()
  return <ExamSetupLoader key={id} id={id} paperFirst={paperFirst} />
}
