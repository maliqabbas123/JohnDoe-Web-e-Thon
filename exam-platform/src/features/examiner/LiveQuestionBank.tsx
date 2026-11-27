'use client'

import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import {
  Badge,
  Button,
  Field,
  Heading,
  Modal,
  Panel,
} from '@/components/shared'
import { api } from '@/lib/api'
import { QuestionImport } from './QuestionImport'
import {
  questionApiPath,
  questionBankError,
  questionBankHref,
  questionDifficultyLabels,
  questionTypeLabels,
  topicApiPath,
  type BankQuestion,
  type QuestionTopic,
} from './questionBankApi'

const pageSize = 20

export function LiveQuestionBank() {
  const [topics, setTopics] = useState<QuestionTopic[]>([])
  const [questions, setQuestions] = useState<BankQuestion[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [archived, setArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [topicId, setTopicId] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [type, setType] = useState('')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [topicsError, setTopicsError] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [notice, setNotice] = useState('')
  const [mutating, setMutating] = useState(false)
  const [dialog, setDialog] = useState<'topics' | 'import'>()

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (search.trim() === query) return
      setPage(1)
      setQuery(search.trim())
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, search])

  useEffect(() => {
    const request = new AbortController()
    setTopicsError('')
    api<QuestionTopic[]>('/topics', { signal: request.signal })
      .then(({ data }) => {
        if (!request.signal.aborted) setTopics(data)
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setTopicsError(questionBankError(error))
      })
    return () => request.abort()
  }, [revision])

  useEffect(() => {
    const request = new AbortController()
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    })
    if (archived) params.set('isArchived', 'true')
    if (query) params.set('q', query)
    if (topicId) params.set('topicId', topicId)
    if (difficulty) params.set('difficulty', difficulty)
    if (type) params.set('type', type)
    setLoading(true)
    setListError('')
    api<BankQuestion[]>('/questions?' + params, { signal: request.signal })
      .then(({ data, meta }) => {
        if (request.signal.aborted) return
        setQuestions(data)
        setTotal(Number(meta?.total ?? data.length))
      })
      .catch((error: unknown) => {
        if (!request.signal.aborted) setListError(questionBankError(error))
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false)
      })
    return () => request.abort()
  }, [archived, difficulty, page, query, revision, topicId, type])

  function refresh() {
    setPage(1)
    setRevision((number) => number + 1)
  }

  async function updateArchive(question: BankQuestion, remove = false) {
    if (mutating) return
    if (
      remove &&
      !window.confirm(
        'Remove this question? Questions already used in exams or attempts are archived.',
      )
    )
      return
    setMutating(true)
    setMutationError('')
    setNotice('')
    try {
      const path = questionApiPath(question.id)
      if (remove) {
        const { data } = await api<{ outcome: 'DELETED' | 'ARCHIVED' }>(path, {
          method: 'DELETE',
        })
        setNotice(
          data.outcome === 'DELETED'
            ? 'Question deleted.'
            : 'Question archived because it has been used.',
        )
      } else {
        await api(path, {
          method: 'PATCH',
          body: JSON.stringify({ isArchived: !question.isArchived }),
        })
        setNotice(
          question.isArchived ? 'Question restored.' : 'Question archived.',
        )
      }
      refresh()
    } catch (error) {
      setMutationError(questionBankError(error))
    } finally {
      setMutating(false)
    }
  }

  const lastPage = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      <Heading
        title="Question bank"
        actions={
          <>
            <Button secondary onClick={() => setDialog('topics')}>
              Manage topics
            </Button>
            <Button secondary onClick={() => setDialog('import')}>
              Import questions
            </Button>
            <Button to={questionBankHref + '/new'}>Create question</Button>
          </>
        }
      />
      <Panel>
        <div className="actions" aria-label="Question status" role="group">
          {[false, true].map((value) => (
            <button
              key={String(value)}
              type="button"
              className={archived === value ? 'button' : 'button secondary'}
              aria-pressed={archived === value}
              onClick={() => {
                setArchived(value)
                setPage(1)
              }}
            >
              {value ? 'Archived' : 'Active'}
            </button>
          ))}
        </div>
        <div className="table-tools">
          <Field label="Search questions">
            <input
              maxLength={100}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Topic">
            <select
              value={topicId}
              onChange={(event) => {
                setTopicId(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All topics</option>
              {topics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Difficulty">
            <select
              value={difficulty}
              onChange={(event) => {
                setDifficulty(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All difficulties</option>
              {Object.entries(questionDifficultyLabels).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Question type">
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value)
                setPage(1)
              }}
            >
              <option value="">All types</option>
              {Object.entries(questionTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {notice && <p role="status">{notice}</p>}
        {(mutationError || topicsError) && (
          <p role="alert">{mutationError || topicsError}</p>
        )}
        {listError ? (
          <>
            <p role="alert">{listError}</p>
            <Button secondary onClick={refresh}>
              Retry
            </Button>
          </>
        ) : loading ? (
          <p role="status">Loading questions…</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    {[
                      'Question',
                      'Topic',
                      'Difficulty',
                      'Type',
                      'Marks',
                      'Exams using it',
                      'Actions',
                    ].map((label) => (
                      <th key={label} scope="col">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {questions.map((question) => (
                    <tr key={question.id}>
                      <td>{question.text}</td>
                      <td>{question.topic.name}</td>
                      <td>
                        <Badge>
                          {questionDifficultyLabels[question.difficulty]}
                        </Badge>
                      </td>
                      <td>{questionTypeLabels[question.type]}</td>
                      <td>{question.defaultMarks}</td>
                      <td>{question.usedInExams}</td>
                      <td>
                        <div className="actions">
                          <Link
                            href={
                              questionBankHref +
                              '/' +
                              encodeURIComponent(question.id) +
                              '/edit'
                            }
                          >
                            Edit
                          </Link>
                          <Button
                            secondary
                            disabled={mutating}
                            onClick={() => void updateArchive(question)}
                          >
                            {question.isArchived ? 'Restore' : 'Archive'}
                          </Button>
                          <Button
                            secondary
                            disabled={mutating}
                            onClick={() => void updateArchive(question, true)}
                          >
                            Remove
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!questions.length && (
                    <tr>
                      <td colSpan={7}>No matching questions.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="pagination">
              <span>
                {total} {total === 1 ? 'question' : 'questions'}
              </span>
              <div className="actions">
                <Button
                  secondary
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Previous
                </Button>
                <span>
                  Page {page} of {lastPage}
                </span>
                <Button
                  secondary
                  disabled={page >= lastPage}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Panel>
      {dialog === 'topics' && (
        <Modal title="Manage topics" close={() => setDialog(undefined)}>
          <TopicManager
            topics={topics}
            changed={(id, deleted) => {
              if (deleted && id === topicId) setTopicId('')
              refresh()
            }}
          />
        </Modal>
      )}
      {dialog === 'import' && (
        <Modal title="Import questions" close={() => setDialog(undefined)}>
          <QuestionImport topics={topics} imported={refresh} />
        </Modal>
      )}
    </>
  )
}

function TopicManager({
  topics,
  changed,
}: {
  topics: QuestionTopic[]
  changed: (id: string, deleted: boolean) => void
}) {
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const selected = topics.find((topic) => topic.id === selectedId)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const { data } = await api<QuestionTopic>(
        selected ? topicApiPath(selected.id) : '/topics',
        {
          method: selected ? 'PATCH' : 'POST',
          body: JSON.stringify({ name: name.trim() }),
        },
      )
      setSelectedId('')
      setName('')
      changed(data.id, false)
    } catch (error) {
      setError(questionBankError(error))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!selected || saving || !window.confirm('Delete this topic?')) return
    setSaving(true)
    setError('')
    try {
      await api(topicApiPath(selected.id), { method: 'DELETE' })
      setSelectedId('')
      setName('')
      changed(selected.id, true)
    } catch (error) {
      setError(questionBankError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save}>
      <Field label="Topic">
        <select
          value={selectedId}
          disabled={saving}
          onChange={(event) => {
            const topic = topics.find(
              (topic) => topic.id === event.target.value,
            )
            setSelectedId(topic?.id ?? '')
            setName(topic?.name ?? '')
            setError('')
          }}
        >
          <option value="">Create a topic</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Topic name">
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <Button type="submit" disabled={saving}>
          {selected ? 'Rename topic' : 'Create topic'}
        </Button>
        {selected && (
          <Button
            secondary
            disabled={saving || selected.questionCount > 0}
            onClick={() => void remove()}
          >
            Delete topic
          </Button>
        )}
      </div>
    </form>
  )
}
