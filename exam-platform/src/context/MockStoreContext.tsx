'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Attempt, Exam, Question, Role, State, User } from '../types'
export const id = () => crypto.randomUUID()
export const iso = (time: number) =>
  new Date(time - new Date(time).getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16)
export const date = (time: string | number) =>
  new Date(time).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
export const home = (role?: Role) =>
  role === 'Administrator'
    ? '/admin'
    : role === 'Examiner'
      ? '/examiner'
      : role === 'Candidate'
        ? '/candidate'
        : '/'
const now = Date.now()
const roles: Role[] = [
  'Administrator',
  'Examiner',
  'Candidate',
  'Candidate',
  'Candidate',
]
const users: User[] = [
  'Morgan Ellis',
  'Dr. Avery Chen',
  'Jordan Reyes',
  'Samira Ali',
  'Noah Bennett',
].map((name, i) => ({
  id: 'u' + (i + 1),
  name,
  email:
    ['admin', 'examiner', 'candidate', 'samira', 'noah'][i] +
    '@proctorate.test',
  role: roles[i],
  active: true,
  password: 'Demo2026!',
  history: [roles[i] + ' assigned at onboarding'],
  logins: [now - 86400000 * (i + 1)],
}))
const questions: Question[] = [
  {
    id: 'q1',
    prompt: 'Which measure is most resistant to extreme outliers in a dataset?',
    topic: 'Statistics',
    difficulty: 'Easy',
    kind: 'Single-Answer MCQ',
    options: ['Mean', 'Median', 'Range', 'Standard deviation'],
    correct: [1],
    rubric: '',
    partial: false,
    marks: 5,
  },
  {
    id: 'q2',
    prompt:
      'Which of the following are valid methods for reducing sampling bias? Select all that apply.',
    topic: 'Research Methods',
    difficulty: 'Medium',
    kind: 'Multiple-Select',
    options: [
      'Random sampling',
      'Convenience sampling',
      'Stratified sampling',
      'Excluding nonrespondents without review',
    ],
    correct: [0, 2],
    rubric: '',
    partial: true,
    marks: 5,
  },
  {
    id: 'q3',
    prompt:
      'Explain how a researcher can distinguish correlation from causation. Include one example of a confounding variable.',
    topic: 'Research Methods',
    difficulty: 'Hard',
    kind: 'Written Response',
    options: [],
    correct: [],
    rubric:
      '4 marks for explaining correlation vs. causation, 4 for an appropriate confounder, 2 for clarity.',
    partial: false,
    marks: 10,
  },
  {
    id: 'q4',
    prompt:
      'What does a 95% confidence interval describe across repeated samples?',
    topic: 'Statistics',
    difficulty: 'Medium',
    kind: 'Single-Answer MCQ',
    options: [
      'The proportion of sample values inside it',
      'The long-run coverage of the interval procedure',
      'The probability the sample mean is correct',
      'The percentage of outliers',
    ],
    correct: [1],
    rubric: '',
    partial: false,
    marks: 5,
  },
  {
    id: 'q5',
    prompt:
      'Which statistic identifies the middle observation in an ordered sample?',
    topic: 'Statistics',
    difficulty: 'Easy',
    kind: 'Single-Answer MCQ',
    options: ['Mode', 'Variance', 'Median', 'Mean'],
    correct: [2],
    rubric: '',
    partial: false,
    marks: 5,
  },
  {
    id: 'q6',
    prompt: 'Which approaches can improve representation in a survey sample?',
    topic: 'Research Methods',
    difficulty: 'Medium',
    kind: 'Multiple-Select',
    options: [
      'Recruiting only volunteers',
      'Random sampling within each subgroup',
      'Following up with nonrespondents',
      'Removing smaller demographic groups',
    ],
    correct: [1, 2],
    rubric: '',
    partial: true,
    marks: 5,
  },
  {
    id: 'q7',
    prompt:
      'A report associates regular exercise with better grades. Explain a possible confounder and describe a study design that strengthens a causal claim.',
    topic: 'Research Methods',
    difficulty: 'Hard',
    kind: 'Written Response',
    options: [],
    correct: [],
    rubric:
      '4 marks for a plausible confounder, 4 for a defensible study design, 2 for clarity.',
    partial: false,
    marks: 10,
  },
]
const exams: Exam[] = [
  ['e1', 'Applied Statistics Midterm', 'STAT 204', 'Ongoing'],
  ['e2', 'Research Methods Assessment', 'RES 210', 'Published'],
  ['e3', 'Data Literacy Fundamentals', 'DATA 101', 'Completed'],
  ['e4', 'Quantitative Reasoning Final', 'STAT 305', 'Draft'],
].map(([id, title, subject, status], i) => ({
  id,
  title,
  subject,
  status: status as Exam['status'],
  owner: 'u2',
  date: iso(now + [0, 4, -7, 9][i] * 86400000 - 3600000),
  close: iso(now + [1, 5, -6, 10][i] * 86400000),
  duration: 60,
  total: 20,
  instructions:
    'Read each question carefully. You may revisit questions before submitting. Use the digital scratchpad for rough work.',
  shuffle: false,
  shuffleOptions: false,
  paper: questions.slice(0, 3).map((q) => ({ id: q.id, marks: q.marks })),
  candidates: ['u3', 'u4', 'u5'],
  released: i === 2,
  blueprint: {
    Easy: 33,
    Medium: 33,
    Hard: 34,
    Statistics: 33,
    'Research Methods': 67,
  },
  normalization: 0,
}))
export function newAttempt(
  exam: Exam,
  user: string,
  time: number,
  bank: Question[] = questions,
): Attempt {
  const variant = ['A', 'B', 'C'][Math.floor(Math.random() * 3)]
  const paper = structuredClone(exam.variants?.[variant] ?? exam.paper)
  return {
    id: id(),
    exam: exam.id,
    user,
    start: time,
    end: time + exam.duration * 60000,
    answers: {},
    grades: {},
    flags: [],
    scratch: '',
    incidents: [],
    grace: 0,
    review: 'Unreviewed',
    pending: false,
    variant,
    code: 'CERT-' + id().slice(0, 13).replace('-', '').toUpperCase(),
    paper,
    questions: structuredClone(
      bank.filter((q) => paper.some((p) => p.id === q.id)),
    ),
  }
}
const attempts: Attempt[] = users.slice(2).map((u, i) => ({
  ...newAttempt(exams[2], u.id, now - 7 * 86400000),
  id: 'a' + (i + 1),
  submitted: now - 7 * 86400000 + 2700000,
  code: 'CERT-2026-' + (8841 + i),
  answers: {
    q1: [1],
    q2: i === 1 ? [0] : [0, 2],
    q3: 'Correlation identifies an association. Temperature can confound the relationship between ice cream sales and swimming injuries.',
  },
  grades: {
    q3: {
      score: 8 - i,
      feedback:
        'Good example. Explain how controlled assignment could test the causal claim.',
    },
  },
}))
attempts.push({
  ...newAttempt(exams[0], 'u4', now - 900000),
  id: 'a-live',
  answers: { q1: [1] },
  incidents: [
    {
      at: now - 500000,
      type: 'Network',
      message: 'Connection briefly interrupted',
    },
  ],
})
const seed: State = {
  users,
  exams,
  questions,
  attempts,
  disputes: [
    {
      id: 'd1',
      exam: 'e3',
      user: 'u3',
      question: 'q3',
      type: 'Grading appeal',
      claim: 'Please review how the confounding variable example was scored.',
      status: 'Escalated',
      notes: 'Escalated after initial examiner review.',
      revisions: [
        { at: now - 86400000, summary: 'Escalated to administrator' },
      ],
    },
  ],
  audit: [
    {
      at: now - 3600000,
      type: 'Exam',
      message: 'Applied Statistics Midterm opened',
    },
    { at: now - 86400000, type: 'Access', message: 'Morgan Ellis signed in' },
    {
      at: now - 6 * 86400000,
      type: 'Results',
      message: 'Data Literacy Fundamentals results published',
    },
  ],
  messages: [
    {
      exam: 'e1',
      body: 'If your connection drops, keep working. Your responses are saved locally.',
      at: now - 360000,
    },
  ],
  outages: [],
  policy: {
    timeout: 60,
    password: 8,
    importLimit: 500,
    threshold: 5,
    incidents: true,
  },
  tokens: {
    'INVITE-DEMO': { user: 'u5', purpose: 'invite' },
    'RESET-DEMO': { user: 'u3', purpose: 'reset' },
  },
  preferences: {},
}
const boot = Date.now(),
  tick = performance.now()
export const serverNow = () => boot + performance.now() - tick
export function score(exam: Exam, attempt: Attempt, questions: Question[]) {
  return (attempt.paper ?? exam.paper).reduce((sum, item) => {
    const q = (attempt.questions ?? questions).find((q) => q.id === item.id),
      a = attempt.answers[item.id]
    if (!q) return sum
    if (attempt.grades[q.id] || q.kind === 'Written Response')
      return sum + (attempt.grades[q.id]?.score ?? 0)
    if (!Array.isArray(a)) return sum
    if (q.partial && q.kind === 'Multiple-Select')
      return (
        sum +
        item.marks *
          Math.max(
            0,
            (a.filter((x) => q.correct.includes(x)).length -
              a.filter((x) => !q.correct.includes(x)).length) /
              Math.max(1, q.correct.length),
          )
      )
    return (
      sum +
      (a.length === q.correct.length && q.correct.every((x) => a.includes(x))
        ? item.marks
        : 0)
    )
  }, 0)
}
export const finalScore = (
  exam: Exam,
  attempt: Attempt,
  questions: Question[],
) =>
  Math.min(
    exam.total,
    Math.max(0, score(exam, attempt, questions) + exam.normalization),
  )
type Store = {
  ready: boolean
  state: State
  update: (fn: (draft: State) => void) => void
  user: User | undefined
  login: (id: string) => void
  logout: () => void
  notice: string
  toast: (value: string) => void
}
const Context = createContext<Store | null>(null)
const stateKey = 'proctorate.data.v1',
  sessionKey = 'proctorate.session.v1'
function readState(): State {
  try {
    return JSON.parse(localStorage.getItem(stateKey) ?? 'null') ?? seed
  } catch {
    return seed
  }
}
export function MockStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(seed),
    [session, setSession] = useState<{ uid: string; at: number } | null>(null),
    [notice, toast] = useState(''),
    [ready, setReady] = useState(false)
  useEffect(() => {
    const loaded = readState()
    setState(loaded)
    if (!localStorage.getItem(stateKey))
      localStorage.setItem(stateKey, JSON.stringify(loaded))
    const uid = sessionStorage.getItem(sessionKey)
    const at = Number(sessionStorage.getItem(sessionKey + '.at'))
    if (uid && at) setSession({ uid, at })
    setReady(true)
  }, [])
  const update = (fn: (draft: State) => void) => {
    const draft = structuredClone(readState())
    fn(draft)
    localStorage.setItem(stateKey, JSON.stringify(draft))
    setState(draft)
  }
  const user = state.users.find(
    (u) =>
      u.id === session?.uid &&
      u.active &&
      session.at > (u.revokedAt ?? 0) &&
      serverNow() - session.at < state.policy.timeout * 60000,
  )
  const logout = () => {
    sessionStorage.removeItem(sessionKey)
    sessionStorage.removeItem(sessionKey + '.at')
    setSession(null)
  }
  const login = (uid: string) => {
    const at = serverNow()
    sessionStorage.setItem(sessionKey, uid)
    sessionStorage.setItem(sessionKey + '.at', String(at))
    setSession({ uid, at })
    update((s) => {
      const u = s.users.find((u) => u.id === uid)
      if (u) {
        u.logins.unshift(serverNow())
        s.audit.unshift({
          at: serverNow(),
          type: 'Access',
          message: u.name + ' signed in',
        })
      }
    })
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === stateKey) setState(readState())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => {
    if (!session) return
    const check = () => {
      if (!user || serverNow() - session.at >= state.policy.timeout * 60000)
        logout()
    }
    check()
    const timer = setInterval(check, 1000)
    return () => clearInterval(timer)
  }, [session, user, state.policy.timeout])
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => toast(''), 3600)
      return () => clearTimeout(timer)
    }
  }, [notice])
  return (
    <Context.Provider
      value={{ ready, state, update, user, login, logout, notice, toast }}
    >
      {children}
    </Context.Provider>
  )
}
export function useStore() {
  const store = useContext(Context)
  if (!store) throw Error('Mock store provider is missing')
  return store
}
