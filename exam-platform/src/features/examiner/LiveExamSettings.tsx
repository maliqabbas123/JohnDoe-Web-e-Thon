'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button, Field, Panel } from '@/components/shared'
import { localDateInput, type ExamDetail } from './examApi'

const examToggles = [
  ['shuffleQuestions', 'Shuffle questions'],
  ['shuffleOptions', 'Shuffle answer options'],
  ['revealAnswers', 'Reveal answers after release'],
  ['desktopOnly', 'Require a desktop browser'],
  ['blockClipboard', 'Block clipboard actions'],
  ['blockContextMenu', 'Block the context menu'],
  ['requireFullscreen', 'Require full screen'],
  ['detectExtraDisplay', 'Detect extra displays'],
  ['watermark', 'Show a candidate watermark'],
  ['aiNotice', 'Show the AI-use notice'],
  ['honeypot', 'Use hidden integrity signals'],
] as const

function toForm(exam: ExamDetail) {
  return {
    title: exam.title,
    instructions: exam.instructions,
    startsAt: localDateInput(exam.startsAt),
    endsAt: localDateInput(exam.endsAt),
    durationMinutes: String(exam.durationMinutes),
    totalMarks: String(exam.totalMarks),
    selectionMode: exam.selectionMode,
    multiSelectScoring: exam.multiSelectScoring,
    maxAttempts: String(exam.maxAttempts ?? ''),
    resultPolicy: exam.resultPolicy,
    disputeWindowHours: String(exam.disputeWindowHours ?? ''),
    ...(Object.fromEntries(
      examToggles.map(([name]) => [name, exam[name]]),
    ) as Record<(typeof examToggles)[number][0], boolean>),
  }
}

type SettingsDraft = ReturnType<typeof toForm>

export function LiveExamSettings({
  exam,
  busy,
  paperDirty,
  onDirtyChange,
  save,
}: {
  exam: ExamDetail
  busy: boolean
  paperDirty: boolean
  onDirtyChange: (dirty: boolean) => void
  save: (payload: object) => Promise<ExamDetail | undefined>
}) {
  const [saved, setSaved] = useState(() => toForm(exam))
  const [draft, setDraft] = useState(saved)
  const keys = Object.keys(draft) as (keyof SettingsDraft)[]
  const changed = keys.filter((key) => draft[key] !== saved[key])
  const dirty = changed.length > 0
  const paperLocked = exam.state === 'ONGOING' || exam.state === 'COMPLETED'

  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  function change<K extends keyof SettingsDraft>(
    key: K,
    value: SettingsDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function text(
    key: {
      [K in keyof SettingsDraft]: SettingsDraft[K] extends string ? K : never
    }[keyof SettingsDraft],
  ) {
    return {
      value: draft[key],
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => change(key, event.target.value),
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const patch = Object.fromEntries(
      changed.map((key) => {
        switch (key) {
          case 'startsAt':
          case 'endsAt':
            return [key, new Date(draft[key]).toISOString()]
          case 'maxAttempts':
          case 'disputeWindowHours':
            return [key, draft[key] === '' ? null : Number(draft[key])]
          case 'durationMinutes':
          case 'totalMarks':
            return [key, Number(draft[key])]
          default:
            return [key, draft[key]]
        }
      }),
    )
    const result = await save(patch)
    if (result) {
      const next = toForm(result)
      setSaved(next)
      setDraft(next)
      onDirtyChange(false)
    }
  }

  return (
    <section id="exam-settings">
      <Panel title="Examination settings">
        <form onSubmit={submit}>
          <fieldset disabled={busy || paperLocked}>
            <legend>Schedule and paper</legend>
            <Field label="Title">
              <input {...text('title')} maxLength={200} required />
            </Field>
            <div className="two-col">
              <Field label="Opens (local time)">
                <input {...text('startsAt')} type="datetime-local" required />
              </Field>
              <Field label="Closes (local time)">
                <input {...text('endsAt')} type="datetime-local" required />
              </Field>
              <Field label="Duration in minutes">
                <input
                  {...text('durationMinutes')}
                  type="number"
                  min={1}
                  max={2_147_483_647}
                  required
                />
              </Field>
              <Field label="Total marks">
                <input
                  {...text('totalMarks')}
                  type="number"
                  min="0.01"
                  max="99999.99"
                  step="0.01"
                  required
                />
              </Field>
              <Field label="Paper selection">
                <select
                  value={draft.selectionMode}
                  disabled={paperDirty}
                  onChange={(event) =>
                    change(
                      'selectionMode',
                      event.target.value as SettingsDraft['selectionMode'],
                    )
                  }
                >
                  <option value="FIXED">Fixed paper</option>
                  <option value="BALANCED">Balanced paper</option>
                </select>
              </Field>
              <Field label="Multiple-select scoring">
                <select
                  value={draft.multiSelectScoring}
                  onChange={(event) =>
                    change(
                      'multiSelectScoring',
                      event.target.value as SettingsDraft['multiSelectScoring'],
                    )
                  }
                >
                  <option value="ALL_OR_NOTHING">All or nothing</option>
                  <option value="PARTIAL">Partial credit</option>
                </select>
              </Field>
            </div>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>Instructions and results</legend>
            <Field label="Candidate instructions">
              <textarea {...text('instructions')} rows={4} maxLength={10_000} />
            </Field>
            <div className="two-col">
              <Field label="Attempt limit (blank for unlimited)">
                <input
                  {...text('maxAttempts')}
                  type="number"
                  min={1}
                  max={2_147_483_647}
                />
              </Field>
              <Field label="Result policy">
                <select
                  value={draft.resultPolicy}
                  onChange={(event) =>
                    change(
                      'resultPolicy',
                      event.target.value as SettingsDraft['resultPolicy'],
                    )
                  }
                >
                  <option value="BEST">Best attempt</option>
                  <option value="LATEST">Latest attempt</option>
                </select>
              </Field>
              <Field label="Dispute window in hours (blank to disable)">
                <input
                  {...text('disputeWindowHours')}
                  type="number"
                  min={1}
                  max={2_147_483_647}
                />
              </Field>
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.revealAnswers}
                onChange={(event) =>
                  change('revealAnswers', event.target.checked)
                }
              />
              Reveal answers after release
            </label>
          </fieldset>
          <fieldset disabled={busy || paperLocked}>
            <legend>Exam workspace rules</legend>
            <div className="two-col">
              {examToggles
                .filter(([key]) => key !== 'revealAnswers')
                .map(([key, label]) => (
                  <label className="check" key={key}>
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={(event) => change(key, event.target.checked)}
                    />
                    {label}
                  </label>
                ))}
            </div>
          </fieldset>
          <div className="actions">
            <Button type="submit" disabled={busy || !dirty}>
              Save settings
            </Button>
            {dirty && (
              <Button secondary disabled={busy} onClick={() => setDraft(saved)}>
                Discard changes
              </Button>
            )}
          </div>
        </form>
      </Panel>
    </section>
  )
}
