'use client'

import Link from 'next/link'
import { useState } from 'react'
import { isLive } from '@/lib/api'
import { LiveQuestionBank } from './LiveQuestionBank'
import {
  Badge,
  Button,
  DataTable,
  Heading,
  ImportModal,
  Panel,
} from '../../components/shared'
import { useStore } from '../../context/MockStoreContext'
import type { Difficulty, Kind } from '../../types'

import { blank, difficulties, kinds, qp, validate } from './shared'

export function QuestionBankPage() {
  return isLive ? <LiveQuestionBank /> : <DemoQuestionBank />
}

function DemoQuestionBank() {
  const { state, update, toast } = useStore(),
    [open, set] = useState(false)
  return (
    <>
      <Heading
        title="Question bank"
        subtitle="Manage reusable items and marking schemes."
        actions={
          <>
            <Button secondary onClick={() => set(true)}>
              Import questions
            </Button>
            <Button to="/examiner/questions/new">Create question</Button>
          </>
        }
      />
      <Panel>
        <DataTable
          columns={[
            'Question',
            'Topic',
            'Difficulty',
            'Type',
            'Marks',
            'Actions',
          ]}
          filters={{
            Topic: [...new Set(state.questions.map((q) => q.topic))],
            Difficulty: difficulties,
            Type: kinds,
          }}
          rows={state.questions.map((q) => ({
            key: q.id,
            search: q.prompt + ' ' + q.topic,
            filters: { Topic: q.topic, Difficulty: q.difficulty, Type: q.kind },
            cells: [
              q.prompt,
              q.topic,
              <Badge>{q.difficulty}</Badge>,
              q.kind,
              q.marks,
              <div className="actions">
                <Link href={qp(q.id) + '/edit'}>Edit</Link>
                <Link href={qp(q.id) + '/analytics'}>Analytics</Link>
              </div>,
            ],
          }))}
        />
      </Panel>
      {open && (
        <ImportModal
          title="Bulk question import"
          close={() => set(false)}
          limit={state.policy.importLimit}
          fields="prompt, topic, difficulty, kind, marks, options, correct (zero-based), rubric, partial. Use | between CSV list values"
          parse={(row) => {
            const list = (v: unknown) =>
              Array.isArray(v)
                ? v
                : String(v ?? '')
                    .split('|')
                    .filter(Boolean)
            const q = {
              ...blank(),
              prompt: String(row.prompt ?? ''),
              topic: String(row.topic ?? ''),
              difficulty: row.difficulty as Difficulty,
              kind: row.kind as Kind,
              marks: Number(row.marks),
              options: list(row.options).map(String),
              correct: list(row.correct).map(Number),
              rubric: String(row.rubric ?? ''),
              partial: row.partial === true || row.partial === 'true',
            }
            validate(q)
            return q
          }}
          save={(rows) => {
            update((s) => s.questions.push(...rows))
            toast('Questions imported.')
          }}
        />
      )}
    </>
  )
}
