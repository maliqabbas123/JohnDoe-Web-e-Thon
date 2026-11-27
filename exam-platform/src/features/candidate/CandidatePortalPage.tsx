'use client'

import { BookOpen, CalendarDays, ClipboardCheck, Clock3 } from 'lucide-react'
import { Badge, Button, Heading, Panel, Tabs } from '../../components/shared'
import {
  date,
  finalScore,
  serverNow,
  useStore,
} from '../../context/MockStoreContext'

import { defaults, path, Preferences } from './shared'

export function CandidatePortalPage() {
  const { state, user, update } = useStore(),
    exams = state.exams.filter(
      (e) => e.candidates.includes(user!.id) && e.status !== 'Draft',
    ),
    pref = state.preferences[user!.id] ?? defaults
  return (
    <>
      <Heading
        title={'Welcome, ' + user!.name.split(' ')[0]}
        subtitle="Access your examinations, published results, and workspace preferences."
      />
      <Panel>
        <Tabs
          labels={[
            'My examinations',
            'Published results',
            'Profile & preferences',
          ]}
        >
          {(i) =>
            i === 0 ? (
              <div className="candidate-exam-grid">
                {['Available', 'Upcoming', 'Completed'].map((group) => {
                  const entries = exams.filter((exam) => {
                    const attempt = state.attempts.find(
                      (a) => a.exam === exam.id && a.user === user!.id,
                    )
                    if (
                      attempt?.submitted ||
                      exam.status === 'Completed' ||
                      serverNow() > new Date(exam.close).getTime()
                    )
                      return group === 'Completed'
                    if (
                      exam.status === 'Ongoing' &&
                      serverNow() >= new Date(exam.date).getTime()
                    )
                      return group === 'Available'
                    return group === 'Upcoming'
                  })
                  return (
                    <section key={group}>
                      <h2>{group}</h2>
                      {entries.length ? (
                        entries.map((exam) => {
                          const attempt = state.attempts.find(
                            (a) => a.exam === exam.id && a.user === user!.id,
                          )
                          const Icon =
                            group === 'Completed'
                              ? ClipboardCheck
                              : group === 'Upcoming'
                                ? CalendarDays
                                : BookOpen
                          const published = exam.released && !attempt?.pending
                          return (
                            <article
                              className="exam-card"
                              key={exam.id}
                              data-status={group}
                            >
                              <div className="exam-card-cover">
                                <Icon size={40} strokeWidth={1.35} />
                                <Badge>{exam.subject}</Badge>
                              </div>
                              <div className="exam-card-body">
                                <h3>{exam.title}</h3>
                                <div className="exam-card-detail">
                                  <Clock3 size={16} />
                                  {exam.duration} min · {exam.paper.length}{' '}
                                  questions
                                </div>
                                <div className="exam-card-detail">
                                  <CalendarDays size={16} />
                                  {date(exam.date)} to {date(exam.close)}
                                </div>
                                {group === 'Available' && (
                                  <Button
                                    to={
                                      path(exam.id) +
                                      (attempt ? '/recover' : '/lobby')
                                    }
                                  >
                                    {attempt ? 'Resume attempt' : 'Open lobby'}
                                  </Button>
                                )}
                                {group === 'Upcoming' && (
                                  <Badge>
                                    {exam.status === 'Published'
                                      ? 'Published'
                                      : 'Awaiting opening'}
                                  </Badge>
                                )}
                                {group === 'Completed' &&
                                  attempt?.submitted && (
                                    <Button
                                      secondary
                                      to={
                                        path(exam.id) +
                                        (published ? '/result' : '/submitted')
                                      }
                                    >
                                      {published
                                        ? 'View result'
                                        : 'View receipt'}
                                    </Button>
                                  )}
                              </div>
                            </article>
                          )
                        })
                      ) : (
                        <p>No examinations in this group.</p>
                      )}
                    </section>
                  )
                })}
              </div>
            ) : i === 1 ? (
              <div className="exam-list">
                {exams
                  .filter(
                    (e) =>
                      e.released &&
                      state.attempts.some(
                        (a) =>
                          a.exam === e.id &&
                          a.user === user!.id &&
                          a.submitted &&
                          !a.pending,
                      ),
                  )
                  .map((e) => (
                    <article className="exam-row" key={e.id}>
                      <div>
                        <strong>{e.title}</strong>
                        <p>
                          {finalScore(
                            e,
                            state.attempts.find(
                              (a) => a.exam === e.id && a.user === user!.id,
                            )!,
                            state.questions,
                          ).toFixed(1)}{' '}
                          / {e.total}
                        </p>
                      </div>
                      <Button to={path(e.id) + '/result'}>
                        Open scorecard & PDF
                      </Button>
                    </article>
                  ))}
              </div>
            ) : (
              <>
                <h2>{user!.name}</h2>
                <p>{user!.email}</p>
                <Preferences
                  value={pref}
                  change={(value) =>
                    update((s) => {
                      s.preferences[user!.id] = value
                    })
                  }
                />
              </>
            )
          }
        </Tabs>
      </Panel>
    </>
  )
}
