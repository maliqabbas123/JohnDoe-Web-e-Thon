'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Button, Field, Heading, Panel } from '@/components/shared'
import { AnswerInput } from '@/features/candidate/shared'
import { api, ApiError } from '@/lib/api'
import type { Answer } from '@/types'
import {
  questionApiPath,
  questionBankError,
  questionBankHref,
  questionDifficultyLabels,
  questionTypeLabels,
  type BankQuestion,
  type OptionInput,
  type QuestionDifficulty,
  type QuestionInput,
  type QuestionTopic,
  type QuestionType,
} from './questionBankApi'

const emptyOptions = (): OptionInput[] => [
  { text: '', isCorrect: false },
  { text: '', isCorrect: false },
]

export function LiveQuestionEditor({ id }: { id?: string }) {
  const [loaded, setLoaded] = useState<{
    topics: QuestionTopic[]
    question?: BankQuestion
  }>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    const options = { signal: request.signal }
    setError('')
    setLoaded(undefined)
    Promise.all([
      api<QuestionTopic[]>('/topics', options),
      id
        ? api<BankQuestion>(questionApiPath(id), options)
        : Promise.resolve(undefined),
    ])
      .then(([topics, question]) => {
        if (!request.signal.aborted) {
          setLoaded({ topics: topics.data, question: question?.data })
        }
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setError(questionBankError(error))
      })
    return () => request.abort()
  }, [id, retry])

  return (
    <>
      <Heading
        title={id ? 'Edit question' : 'Create question'}
        actions={
          <Button to={questionBankHref} secondary>
            Question bank
          </Button>
        }
      />
      {loaded ? (
        <QuestionForm key={loaded.question?.id ?? 'new'} {...loaded} />
      ) : (
        <Panel title="Question builder">
          {error ? (
            <>
              <p role="alert" className="danger">
                {error}
              </p>
              <Button secondary onClick={() => setRetry((count) => count + 1)}>
                Retry
              </Button>
            </>
          ) : (
            <p role="status">Loading question builder…</p>
          )}
        </Panel>
      )}
    </>
  )
}

function QuestionForm({
  question,
  topics,
}: {
  question?: BankQuestion
  topics: QuestionTopic[]
}) {
  const router = useRouter()
  const [topicId, setTopicId] = useState(question?.topic.id ?? '')
  const [difficulty, setDifficulty] = useState<QuestionDifficulty | ''>(
    question?.difficulty ?? '',
  )
  const [type, setType] = useState<QuestionType>(
    question?.type ?? 'SINGLE_CHOICE',
  )
  const [text, setText] = useState(question?.text ?? '')
  const [explanation, setExplanation] = useState(question?.explanation ?? '')
  const [marks, setMarks] = useState(String(question?.defaultMarks ?? 5))
  const [options, setOptions] = useState<OptionInput[]>(
    () =>
      question?.options.map(({ text, isCorrect }) => ({ text, isCorrect })) ??
      emptyOptions(),
  )
  const [previewAnswer, setPreviewAnswer] = useState<Answer>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [issues, setIssues] = useState<Record<string, string>>({})

  function fieldError(path: string): ReactNode {
    const message = issues[path]
    return (
      message && (
        <span role="alert" className="danger">
          {message}
        </span>
      )
    )
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving || !difficulty) return
    setError('')
    setIssues({})
    const editedOptions = options.map((option) => ({
      ...option,
      text: option.text.trim(),
    }))
    if (type !== 'WRITTEN') {
      const unique = new Set(
        editedOptions.map((option) => option.text.toLowerCase()),
      )
      const correct = editedOptions.filter((option) => option.isCorrect).length
      if (
        editedOptions.some((option) => !option.text) ||
        unique.size !== editedOptions.length
      ) {
        setIssues({ options: 'Enter distinct text for every option.' })
        return
      }
      if (!correct) {
        setIssues({ options: 'Select the correct answer.' })
        return
      }
    }
    const body: QuestionInput = {
      topicId,
      difficulty,
      text: text.trim(),
      explanation: explanation.trim() || null,
      defaultMarks: Number(marks),
      ...(type === 'WRITTEN' ? {} : { options: editedOptions }),
    }
    setSaving(true)
    try {
      if (question) {
        const changes = changedFields(question, body)
        if (Object.keys(changes).length) {
          await api(questionApiPath(question.id), {
            method: 'PATCH',
            body: JSON.stringify(changes),
          })
        }
      } else {
        await api('/questions', {
          method: 'POST',
          body: JSON.stringify({ ...body, type }),
        })
      }
      router.push(questionBankHref)
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        setIssues(
          Object.fromEntries(
            error.details.map(({ path, message }) => [path, message]),
          ),
        )
      } else {
        setError(questionBankError(error))
      }
    } finally {
      setSaving(false)
    }
  }

  if (!topics.length) {
    return (
      <Panel title="Question builder">
        <p>
          Create a topic in the{' '}
          <Link href={questionBankHref}>question bank</Link> before adding a
          question.
        </p>
      </Panel>
    )
  }

  return (
    <div className="two-col">
      <Panel title="Question builder">
        <form onSubmit={save}>
          {question && question.usedInExams > 0 && (
            <p>
              Used in {question.usedInExams}{' '}
              {question.usedInExams === 1 ? 'exam' : 'exams'}. Changes apply to
              future attempts.
            </p>
          )}
          <Field label="Question prompt">
            <textarea
              required
              maxLength={5000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
            {fieldError('text')}
          </Field>
          <div className="two-col">
            <Field label="Topic">
              <select
                required
                value={topicId}
                onChange={(event) => setTopicId(event.target.value)}
              >
                <option value="" disabled>
                  Select a topic
                </option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
              {fieldError('topicId')}
            </Field>
            <Field label="Difficulty">
              <select
                required
                value={difficulty}
                onChange={(event) =>
                  setDifficulty(event.target.value as QuestionDifficulty)
                }
              >
                <option value="" disabled>
                  Select a difficulty
                </option>
                {Object.entries(questionDifficultyLabels).map(
                  ([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ),
                )}
              </select>
              {fieldError('difficulty')}
            </Field>
            <Field label="Question type">
              <select
                disabled={Boolean(question)}
                value={type}
                onChange={(event) => {
                  setType(event.target.value as QuestionType)
                  setPreviewAnswer(undefined)
                  setOptions((previous) =>
                    previous.map((option) => ({ ...option, isCorrect: false })),
                  )
                }}
              >
                {Object.entries(questionTypeLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {fieldError('type')}
            </Field>
            <Field label="Default marks">
              <input
                type="number"
                required
                min=".25"
                max="1000"
                step=".01"
                value={marks}
                onChange={(event) => setMarks(event.target.value)}
              />
              {fieldError('defaultMarks')}
            </Field>
          </div>
          {type !== 'WRITTEN' && (
            <fieldset>
              <legend>Options and correct answers</legend>
              {fieldError('options')}
              {options.map((option, index) => (
                <div key={index}>
                  <div className="option-editor">
                    <input
                      aria-label={'Correct option ' + (index + 1)}
                      type={type === 'SINGLE_CHOICE' ? 'radio' : 'checkbox'}
                      name="correct"
                      checked={option.isCorrect}
                      onChange={() =>
                        setOptions((previous) =>
                          previous.map((entry, position) => ({
                            ...entry,
                            isCorrect:
                              type === 'SINGLE_CHOICE'
                                ? position === index
                                : position === index
                                  ? !entry.isCorrect
                                  : entry.isCorrect,
                          })),
                        )
                      }
                    />
                    <input
                      aria-label={'Option ' + (index + 1)}
                      required
                      maxLength={1000}
                      value={option.text}
                      onChange={(event) => {
                        const nextText = event.target.value
                        setOptions((previous) =>
                          previous.map((entry, position) =>
                            position === index
                              ? { ...entry, text: nextText }
                              : entry,
                          ),
                        )
                      }}
                    />
                    <Button
                      secondary
                      disabled={options.length <= 2}
                      onClick={() => {
                        setPreviewAnswer(undefined)
                        setOptions((previous) =>
                          previous.filter((_, position) => position !== index),
                        )
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                  {fieldError('options.' + index + '.text')}
                </div>
              ))}
              <Button
                secondary
                disabled={options.length >= 10}
                onClick={() =>
                  setOptions((previous) => [
                    ...previous,
                    { text: '', isCorrect: false },
                  ])
                }
              >
                Add option
              </Button>
            </fieldset>
          )}
          <Field
            label={
              type === 'WRITTEN'
                ? 'Marking guide (optional)'
                : 'Explanation (optional)'
            }
          >
            <textarea
              maxLength={5000}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
            />
            {fieldError('explanation')}
          </Field>
          {(error || issues['']) && (
            <p role="alert" className="danger">
              {error || issues['']}
            </p>
          )}
          <div className="actions">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save question'}
            </Button>
            <Button to={questionBankHref} secondary>
              Cancel
            </Button>
          </div>
        </form>
      </Panel>
      <Panel title="Candidate preview">
        <p>{text || 'Enter a question prompt to preview it.'}</p>
        <AnswerInput
          q={{
            id: 'question-candidate-preview',
            kind: questionTypeLabels[type],
            options: options.map(
              (option, index) => option.text || 'Option ' + (index + 1),
            ),
          }}
          answer={previewAnswer}
          change={setPreviewAnswer}
        />
      </Panel>
    </div>
  )
}

function changedFields(
  question: BankQuestion,
  input: QuestionInput,
): Partial<QuestionInput> {
  const changes: Partial<QuestionInput> = {}
  if (question.topic.id !== input.topicId) changes.topicId = input.topicId
  if (question.difficulty !== input.difficulty)
    changes.difficulty = input.difficulty
  if (question.text !== input.text) changes.text = input.text
  if (question.explanation !== input.explanation)
    changes.explanation = input.explanation
  if (question.defaultMarks !== input.defaultMarks)
    changes.defaultMarks = input.defaultMarks
  if (
    input.options &&
    (question.options.length !== input.options.length ||
      input.options.some(
        (option, index) =>
          option.text !== question.options[index].text ||
          option.isCorrect !== question.options[index].isCorrect,
      ))
  ) {
    changes.options = input.options
  }
  return changes
}
