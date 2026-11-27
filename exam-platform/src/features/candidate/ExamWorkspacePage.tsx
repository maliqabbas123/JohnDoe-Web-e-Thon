'use client'

import { Flag, Megaphone, NotebookPen, Settings2 } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { ClientRedirect } from '../../components/auth/RoleGuard'
import {
  Badge,
  Button,
  Field,
  Modal,
  NetworkStatusPill,
  Panel,
  ServerSyncedTimer,
  SlideOverDrawer,
  Stats,
  Timeline,
  useClock,
} from '../../components/shared'
import { newAttempt, serverNow } from '../../context/MockStoreContext'
import type { Attempt } from '../../types'

import {
  AnswerInput,
  Missing,
  Preferences,
  answered,
  defaults,
  seededOrder,
  useExam,
} from './shared'

export function ExamWorkspacePage() {
  const preview = useSearchParams().get('sandbox') === 'true',
    ctx = useExam(preview),
    { state, user, exam, attempt, sandbox, base, update, toast } = ctx,
    router = useRouter(),
    now = useClock(),
    [local, setLocal] = useState(() =>
      exam && sandbox
        ? newAttempt(exam, user!.id, serverNow(), state.questions)
        : undefined,
    ),
    [index, setIndex] = useState(0),
    [drawer, setDrawer] = useState(''),
    [network, setNetwork] = useState(navigator.onLine ? 'Online' : 'Offline'),
    [read, setRead] = useState(0),
    itemOpened = useRef(serverNow())
  const a = sandbox ? local : attempt,
    pref = state.preferences[user!.id] ?? defaults,
    paper =
      exam && a
        ? exam.shuffle
          ? seededOrder(a.paper ?? exam.paper, a.variant)
          : (a.paper ?? exam.paper)
        : [],
    item = paper[index],
    q = (a?.questions ?? state.questions).find((x) => x.id === item?.id),
    messages = state.messages.filter((m) => m.exam === exam?.id),
    count = paper.filter((x) => answered(a?.answers[x.id])).length
  function mutate(change: (a: Attempt) => void) {
    if (!a) return
    if (sandbox) {
      setLocal((old) => {
        if (!old) return old
        const next = structuredClone(old)
        change(next)
        return next
      })
    } else
      update((s) => {
        const target = s.attempts.find((x) => x.id === a!.id)
        if (target) change(target)
      })
  }
  function recordItemTime(target: Attempt) {
    if (item) {
      target.itemTime ??= {}
      target.itemTime[item.id] =
        (target.itemTime[item.id] ?? 0) +
        Math.max(0, serverNow() - itemOpened.current)
    }
  }
  function goTo(next: number) {
    if (next === index) return
    mutate(recordItemTime)
    itemOpened.current = serverNow()
    setIndex(next)
  }
  function submit() {
    if (!a || a.submitted) return
    mutate((x) => {
      if (x.submitted) return
      recordItemTime(x)
      x.submitted = Math.min(serverNow(), x.end)
      x.pending = !sandbox && (network !== 'Online' || !navigator.onLine)
    })
    if (sandbox) {
      toast('Sandbox attempt completed.')
      router.push('/examiner/exams/' + exam!.id + '/setup')
    } else router.replace(base + '/submitted')
  }
  useEffect(() => {
    if (a && !a.submitted && now >= a.end) submit()
  }, [now, a?.end, a?.submitted])
  useEffect(() => {
    if (!a || a.submitted) return
    function event(type: string, message: string) {
      mutate((x) => x.incidents.push({ at: serverNow(), type, message }))
    }
    const blur = () => {
        if (state.policy.incidents)
          event('Focus', 'Workspace lost window focus')
      },
      paste = () => {
        if (state.policy.incidents)
          event('Paste', 'Paste occurred in workspace')
      },
      online = () => {
        setNetwork('Online')
        mutate((x) => {
          x.pending = false
          x.network = 'Online'
        })
        event('Network', 'Connection restored')
      },
      offline = () => {
        setNetwork('Offline')
        mutate((x) => {
          x.network = 'Offline'
        })
        event('Network', 'Connection interrupted')
      }
    addEventListener('blur', blur)
    addEventListener('paste', paste)
    addEventListener('online', online)
    addEventListener('offline', offline)
    return () => {
      removeEventListener('blur', blur)
      removeEventListener('paste', paste)
      removeEventListener('online', online)
      removeEventListener('offline', offline)
    }
  }, [a?.id, a?.submitted, state.policy.incidents])
  if (!exam) return <Missing />
  if (!a) return <ClientRedirect href={base + '/lobby'} />
  if (a.submitted && !sandbox)
    return <ClientRedirect href={base + '/submitted'} />
  return (
    <div
      className={'attempt ' + (pref.contrast ? 'high-contrast' : '')}
      data-size={pref.size}
    >
      <header className="attempt-top">
        <div>
          <strong>{exam.title}</strong>
          <small>
            {sandbox
              ? 'Sandbox preview · No submission recorded'
              : exam.subject + ' · Examination in progress'}
          </small>
        </div>
        <div className="actions">
          <NetworkStatusPill status={network} pending={a.pending} />
          <ServerSyncedTimer end={a.end} />
        </div>
      </header>
      <div className="attempt-content">
        <div className="attempt-tools">
          <div className="actions">
            <Button secondary onClick={() => setDrawer('scratch')}>
              <NotebookPen size={16} /> Scratchpad
            </Button>
            <Button secondary onClick={() => setDrawer('custom')}>
              <Settings2 size={16} /> Workspace
            </Button>
            <Button
              secondary
              onClick={() => {
                setDrawer('messages')
                setRead(messages.length)
              }}
            >
              <Megaphone size={16} /> Announcements{' '}
              {messages.length > read
                ? '(' + (messages.length - read) + ')'
                : ''}
            </Button>
          </div>
          <Button
            secondary
            onClick={() => {
              const next =
                network === 'Online'
                  ? 'Unstable'
                  : network === 'Unstable'
                    ? 'Offline'
                    : 'Online'
              if (next === 'Online' && !navigator.onLine) {
                toast('Restore your browser connection first.')
                return
              }
              setNetwork(next)
              mutate((x) => {
                if (next === 'Online') x.pending = false
                x.network = next
                x.incidents.push({
                  at: serverNow(),
                  type: 'Network',
                  message: 'Simulated network: ' + next,
                })
              })
            }}
          >
            Simulate network
          </Button>
        </div>
        <div className={pref.split ? 'attempt-grid' : ''}>
          <Panel>
            {q ? (
              <>
                <div className="question-meta">
                  <span>
                    Question {index + 1} of {paper.length}
                  </span>
                  <Badge>{item.marks + ' marks'}</Badge>
                </div>
                <h2>{q.prompt}</h2>
                <p>{q.kind}</p>
                <AnswerInput
                  key={q.id}
                  q={q}
                  answer={a.answers[q.id]}
                  order={
                    exam.shuffleOptions
                      ? seededOrder(
                          q.options.map((_, i) => i),
                          a.variant + q.id,
                        )
                      : undefined
                  }
                  change={(value) =>
                    mutate((x) => {
                      const at = serverNow(),
                        firstResponse =
                          !answered(x.answers[q.id]) && answered(value)
                      if (firstResponse) {
                        if (
                          state.policy.incidents &&
                          x.lastAnswerAt &&
                          at - x.lastAnswerAt < 2500
                        )
                          x.incidents.push({
                            at,
                            type: 'Pace',
                            message:
                              'Consecutive first responses less than 2.5 seconds apart',
                          })
                        x.lastAnswerAt = at
                      }
                      x.answers[q.id] = value
                      x.pending = network !== 'Online' || !navigator.onLine
                    })
                  }
                />
                <div className="question-actions">
                  <Button
                    secondary
                    disabled={index === 0}
                    onClick={() => goTo(index - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    secondary
                    onClick={() =>
                      mutate((x) => {
                        x.flags = x.flags.includes(q.id)
                          ? x.flags.filter((v) => v !== q.id)
                          : [...x.flags, q.id]
                      })
                    }
                  >
                    <Flag size={16} />
                    {a.flags.includes(q.id) ? 'Remove flag' : 'Mark for review'}
                  </Button>
                  <Button
                    disabled={index === paper.length - 1}
                    onClick={() => goTo(index + 1)}
                  >
                    Next question
                  </Button>
                </div>
              </>
            ) : (
              <p>This paper contains no questions.</p>
            )}
          </Panel>
          <Panel title="Question navigation">
            <p>
              {count} of {paper.length} answered
            </p>
            <progress value={count} max={paper.length || 1} />
            <div className="palette">
              {paper.map((x, i) => (
                <button
                  key={x.id}
                  className={
                    (a.flags.includes(x.id)
                      ? 'flagged'
                      : answered(a.answers[x.id])
                        ? 'answered'
                        : '') + (i === index ? ' current' : '')
                  }
                  aria-current={i === index ? 'step' : undefined}
                  aria-label={
                    'Question ' +
                    (i + 1) +
                    (a.flags.includes(x.id)
                      ? ', marked for review'
                      : answered(a.answers[x.id])
                        ? ', answered'
                        : ', unanswered')
                  }
                  onClick={() => goTo(i)}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <p>
              <Badge>Answered</Badge> <Badge>Marked for review</Badge>
            </p>
            <Button onClick={() => setDrawer('submit')}>
              Review submission
            </Button>
          </Panel>
        </div>
      </div>
      {drawer === 'scratch' && (
        <SlideOverDrawer title="Digital scratchpad" close={() => setDrawer('')}>
          <Field label="Rough work">
            <textarea
              rows={16}
              value={a.scratch}
              onChange={(e) =>
                mutate((x) => {
                  x.scratch = e.target.value
                })
              }
            />
          </Field>
        </SlideOverDrawer>
      )}
      {drawer === 'custom' && (
        <Modal title="Workspace preferences" close={() => setDrawer('')}>
          <Preferences
            value={pref}
            change={(value) =>
              update((s) => {
                s.preferences[user!.id] = value
              })
            }
          />
        </Modal>
      )}
      {drawer === 'messages' && (
        <SlideOverDrawer title="Live announcements" close={() => setDrawer('')}>
          <Timeline
            events={messages.map((m) => ({
              at: m.at,
              type: 'Examiner',
              message: m.body,
            }))}
          />
        </SlideOverDrawer>
      )}
      {drawer === 'submit' && (
        <Modal title="Review your submission" close={() => setDrawer('')}>
          <Stats
            items={[
              ['Answered', count],
              ['Unanswered', paper.length - count],
              ['Flagged', a.flags.length],
            ]}
          />
          <p>Submitting closes this attempt and locks your responses.</p>
          <div className="actions">
            <Button secondary onClick={() => setDrawer('')}>
              Keep working
            </Button>
            <Button onClick={submit}>Submit examination</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
