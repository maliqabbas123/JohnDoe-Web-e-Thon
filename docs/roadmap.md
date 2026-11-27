# Roadmap

What is built, what is left, and how the remaining work is split so that three people can build in parallel without blocking each other. Read [Contributing](contributing.md) first.

## 1. Status

| Module | State | Brief |
|---|---|---|
| Platform foundation, tests, CI | Built | 06 |
| Auth, sign-up, sessions | Built | 3.1 |
| User management, user activity, force sign-out, sign-in unlock | Built | 3.1 |
| Administrator overview and audit log | Built | 3.1 |
| Question bank | Built | 3.3 |
| Shared paper and scoring rules (`src/server/exam/paper.ts`) | Built | 3.7 |
| Exams and join-code management | Built | 3.2 |
| Enrolment, joining by code, retake grants | Built | 3.4 |
| Attempts, paper draw, sandbox, scratchpad | Built | 3.5, 4.3, 4.8, 5.2 |
| Grading | Built | 3.7 |
| Results and analytics | Built | 3.8, 4.5, 5.2 |
| Disputes | Built | 5.4 |
| Reports and verification | Not started | 4.2, 4.6 |
| Monitoring, disruptions, announcements | Built | 3.6, 5.3 |
| Integrity analysis | Built | 5.1 |
| Question import | Built | 4.4 |
| Candidate import | Built | 4.4 |
| Workspace preferences | Built | 4.7 |
| Deployment | Not started | 07 |

The core schema is migrated. The Exams module adds the unique, nullable join code.

## 2. Workstreams

| Stream | Modules, in order | Can start now? |
|---|---|---|
| **A. Exam flow** | Exams → Enrolment → Attempts | Yes |
| **B. Evaluation** | Grading → Results and analytics → Disputes → Reports | Yes, using inserted fixture rows until stream A's attempts merge |
| **C. Monitoring and tools** | Question import → Workspace preferences → Monitoring → Integrity → Candidate import | Yes; import and preferences depend only on what is built |

Stream A is the critical path: nothing can be demonstrated end to end without it. Streams B and C build against the schema and the contracts in section 3, inserting the attempt rows they need in their tests, and add true end-to-end tests once stream A's attempts module is on `main`.

Each stream edits only its own module folders, plus small, separate changes to the shared files listed in [Contributing, section 8](contributing.md#8-files-that-several-people-edit).

## 3. Contracts between the streams

These are fixed. Changing one needs agreement from all three streams.

### 3.1 The frozen paper

When an attempt starts, each served question is copied into `AttemptQuestion.snapshot` as a `PaperSnapshot` (see `src/server/exam/paper.ts`). `AttemptQuestion.optionOrder` holds the option ids in the order shown to that candidate, and `AttemptQuestion.marks` holds the marks available.

- Candidate-facing responses are built with `toCandidateQuestion(snapshot, optionOrder)`. Nothing else may send question content to a candidate.
- Objective answers are scored with `scoreObjective(snapshot, selectedOptionIds, marks)`.
- The score that counts for a question is `effectiveScore(autoScore, manualScore)`.

### 3.2 Closing an attempt (owned by stream A)

An attempt closes when the candidate submits, or lazily on the first request that touches it after `deadlineAt`. Closing happens in one transaction with a conditional update (`where status = 'IN_PROGRESS'`), so it runs exactly once however many requests race. After it, the rows are in this state:

| Column | Value |
|---|---|
| `Attempt.status` | `SUBMITTED` if the candidate submitted, `EXPIRED` if the server closed it |
| `Attempt.submittedAt` | The server time of submission, or `deadlineAt` for an expired attempt |
| `AttemptQuestion.autoScore` | `scoreObjective(...)` for choice questions; null for written responses |
| `Attempt.gradingStatus` | `GRADED` if the paper has no written responses, otherwise `NEEDS_REVIEW` |
| `Attempt.score` | The sum of scores if `GRADED`, otherwise null |

Stream B takes over from that state. It never needs to call stream A's code.

### 3.3 Recalculating a score (owned by stream B)

Stream B exports `recalculateAttempt(tx, attemptId)` from `src/server/modules/grading/service.ts`. It sums `effectiveScore` over the attempt's questions, sets `Attempt.score`, and sets `gradingStatus` to `GRADED` when no question is left without a score. Manual grading and dispute outcomes call it.

### 3.4 Rules every stream follows

- **Sandbox attempts are invisible.** Every query that reads attempts for monitoring, grading queues, results, analytics, disputes, reports or the administrator overview filters `isSandbox: false`.
- **Which attempt is a candidate's result.** Among their closed, fully graded, non-sandbox attempts for the exam: the highest score when the exam's policy is `BEST` (earliest attempt on a tie), the highest attempt number when it is `LATEST`.
- **Calculated exam state.** `ONGOING` is `status = PUBLISHED` and `startsAt <= now <= endsAt`. Stream A exports a helper for it; do not reimplement it.
- **The deadline never moves.** No module adds time to an attempt. A disruption is evidence; the remedy is a retake grant.
- **Signals are not verdicts.** Monitoring and integrity code never changes a score or a status.
- **Released results change only through `GradeChange`.** Any change to a score after release writes a row there with a reason.

## 4. Stream A: exam flow

### A1. Exams (`examiner-exams`)

| Endpoint | Purpose |
|---|---|
| `GET /exams`, `POST /exams` | Own exams; create a draft |
| `GET /exams/{id}`, `PATCH /exams/{id}` | Read with calculated state; edit settings |
| `PUT /exams/{id}/questions` | Replace the question pool |
| `PUT /exams/{id}/difficulty-rules` | Set questions per paper, and the percentage and marks for each difficulty |
| `GET /exams/{id}/review` | Pre-publish checks, resulting counts per difficulty, warnings |
| `POST /exams/{id}/publish`, `POST /exams/{id}/unpublish`, `POST /exams/{id}/complete` | Lifecycle |
| `POST /exams/{id}/join-code`, `DELETE /exams/{id}/join-code` | Create or replace the join code; turn it off |

Rules:

- Owner only; another examiner's exam is 404.
- A draft is fully editable. A published exam can be unpublished only before its slot starts and only if it has no attempts. Once an attempt exists, the slot, duration, pool and paper rules are locked; instructions, attempt limit, result policy, dispute window and answer reveal stay editable.
- `endsAt` is after `startsAt`; the duration fits inside the slot.
- Pool questions must be the examiner's own and not archived.
- Publishing is refused, with a reason per failed check, unless: the slot starts in the future; **fixed** mode has at least one question and its marks add up to `totalMarks`; **balanced** mode has percentages summing to 100, a pool with enough questions at each difficulty, and `count × marksEach` adding up to `totalMarks`.
- Counts per difficulty come from the percentages by largest remainder, so they always add up to `questionCount`. The review endpoint shows them.
- The review endpoint warns when the pool at a difficulty is no larger than the count needed, because every paper would then be identical.
- The join code is long, random and unguessable; add a nullable unique `joinCode` column to `Exam`.
- Export `examRules(exam)`: the plain-language rules shown to candidates, built from the exam's settings, including every active integrity switch.
- Audit `EXAM_PUBLISHED`, `EXAM_UNPUBLISHED`, `EXAM_COMPLETED`.

### A2. Enrolment (`examiner-enrolment`)

| Endpoint | Purpose |
|---|---|
| `GET /exams/{id}/enrollments`, `POST /exams/{id}/enrollments` | List; enrol candidates by email (up to 500 per request) |
| `DELETE /exams/{id}/enrollments/{candidateId}` | Remove, only before that candidate's first attempt |
| `GET /exams/{id}/retake-grants`, `POST /exams/{id}/retake-grants` | List; give named candidates an extra slot with a reason |
| `POST /me/exams/join` | Candidate enrols with a join code |
| `GET /me/exams` | Candidate's exams with their own status |
| `GET /me/exams/{id}` | Instructions, rules, attempts used and allowed, own status |

Rules:

- Only accounts with the candidate role can be enrolled. The enrol response reports each email as enrolled, already enrolled, or not a registered candidate.
- An examiner can never list or search platform users, only the candidates enrolled in their own exams.
- Joining by code is rate-limited per user, and gives the same response for a wrong code and a disabled one.
- A candidate's status for an exam is one of `UPCOMING`, `AVAILABLE`, `IN_PROGRESS`, `COMPLETED`, taking their retake grants and attempts used into account.
- A retake grant needs a slot that ends after it starts and a written reason, and is audited (`RETAKE_GRANTED`).
- A candidate who is not enrolled gets 404 for the exam.

### A3. Attempts (`candidate-attempts`)

| Endpoint | Purpose |
|---|---|
| `POST /exams/{id}/attempts` | Start; requires `rulesAccepted: true` |
| `GET /attempts/{id}` | Status, deadline, server time, and per position: answered, flagged, marks |
| `GET /attempts/{id}/questions/{position}` | One question for the candidate, with their saved answer |
| `PUT /attempts/{id}/answers/{position}` | Save an answer, review flag and typing counts |
| `PUT /attempts/{id}/scratchpad` | Save rough work |
| `POST /attempts/{id}/submit` | Submit |
| `POST /exams/{id}/sandbox`, `DELETE /exams/{id}/sandbox` | Examiner previews their own exam as a candidate; reset |

Rules:

- Starting checks, on the server clock: enrolled; device allowed if the exam is desktop-only; inside the shared slot or an unrevoked retake grant; attempts left in that slot; no attempt already in progress. Starting twice at once must yield one attempt (the partial unique index enforces it); return the existing one.
- `deadlineAt = min(now + duration, slot end)`.
- Paper: fixed mode serves the whole pool. Balanced mode draws the counts per difficulty at random, rotating across topics inside each difficulty. Question and option order are shuffled when the exam says so.
- Generate a random `honeypotMarker` per attempt when the exam has the honeypot on. Question delivery adds the visible AI notice and the hidden marker instruction; they are not stored in the snapshot.
- Question delivery records `firstOpenedAt`, `openCount`, and adds the time the previous question was on screen to its `timeSpentSeconds`.
- A save is accepted only while the attempt is in progress and before the deadline, only with a higher `revision` than the stored one, and only with option ids that belong to the question. Single choice takes at most one id.
- Every endpoint closes the attempt first if its deadline has passed (section 3.2), then answers accordingly (409 for a write).
- Submitting twice is safe and returns the same result.
- An attempt is visible only to its owner. Anyone else gets 404.
- A sandbox attempt belongs to the examiner, works on a draft exam, ignores the slot and enrolment, and uses the same attempt endpoints.
- Set `Cache-Control: no-store` (the route wrapper does) and never return more than one question per request.

## 5. Stream B: evaluation

### B1. Grading (`examiner-grading`)

| Endpoint | Purpose |
|---|---|
| `GET /exams/{id}/grading` | Written answers waiting for a mark, oldest first |
| `GET /attempts/{id}/review` | Examiner's view of one submission: questions, answers, key, scores |
| `PATCH /attempts/{id}/answers/{position}/grade` | Give a mark and feedback |

Rules: the exam's owner only; the attempt must be closed; the mark is between 0 and the question's marks, to two decimal places; grading calls `recalculateAttempt`; changing a mark after the result was released requires a reason and writes `GradeChange`; two examiners' tabs grading the same answer must not corrupt the total.

### B2. Results and analytics (`examiner-results`)

| Endpoint | Purpose |
|---|---|
| `GET /exams/{id}/results` | Every candidate's result attempt, score, grading and release state |
| `POST /exams/{id}/results/release` | Release every fully graded, unreleased result |
| `GET /me/results`, `GET /me/results/{attemptId}` | Candidate's own released results and attempt review |
| `GET /exams/{id}/analytics` | Count, mean, median, range, distribution; fairness report |
| `GET /exams/{id}/analytics/questions` | Per question: served, skipped, correct rate, average time, most chosen wrong option, observed against labelled difficulty |

Rules: release is repeatable and audited (`RESULT_RELEASED`); attempts still needing review are skipped and reported; a candidate sees only their own released results, and correct answers only when the exam allows it; the fairness report compares each paper's observed difficulty with the others and flags outliers without changing a score.

### B3. Disputes (`candidate-disputes`)

| Endpoint | Purpose |
|---|---|
| `POST /attempts/{id}/disputes` | Raise: questions, category, explanation, optional document |
| `GET /me/disputes` | Candidate's own disputes and decisions |
| `GET /exams/{id}/disputes`, `GET /disputes/{id}` | Examiner's queue; one dispute with its evidence |
| `PATCH /disputes/{id}/items/{itemId}` | Decide one item, with a reason |
| `GET /disputes/{id}/attachment` | Download the document |

Rules: see [ADR 0009](adr/0009-disputes.md). Own, released result only, inside the exam's dispute window; a question can be disputed once; the examiner alone decides, with a written reason and no appeal. Outcomes: a regrade; a fix to a faulty question applied to every attempt that was served it (`alsoAccepted` or `voided` in the snapshot) without lowering any score; or a retake grant. Every score change writes `GradeChange` and supersedes an issued report. The document is PDF, PNG or JPEG up to 4 MB, checked from its content, and served as a download to that candidate and that examiner only.

### B4. Reports (`examiner-reports`)

| Endpoint | Purpose |
|---|---|
| `POST /attempts/{id}/report` | Issue a verifiable report for a released result |
| `GET /attempts/{id}/report.pdf` | Download |
| `GET /verify/{code}` | Public check of a report |

Rules: the PDF is built on the server from stored data with a pure JavaScript library; it carries a random verification code and a QR code of the verification address; the public endpoint is rate-limited and returns only validity, exam title, score and issue date; a superseded or revoked report verifies as such.

## 6. Stream C: monitoring and tools

### C1. Question import (`examiner-import`)

`POST /import/questions` takes CSV or JSON and creates questions in the examiner's bank; `GET /import/jobs` lists past imports. Each row is validated with the same rules as `POST /questions`, including the required difficulty label; valid rows are imported and each rejected row is reported with its row number, field and message; the outcome is stored in `ImportJob`. Limit the file size and row count, and document the column format in the API reference.

### C2. Workspace preferences (`candidate-workspace`)

`GET /me/preferences` and `PUT /me/preferences` store a small, strictly validated settings object (for example font size, theme, palette position) in `UserPreference`.

### C3. Monitoring (`examiner-monitoring`)

| Endpoint | Purpose |
|---|---|
| `POST /attempts/{id}/heartbeat` | Contact signal from the exam page; returns server time, deadline, status and new announcements |
| `POST /attempts/{id}/incidents` | Exam-page events, in small batches |
| `GET /exams/{id}/monitor` | Live attempts: progress, connection, incident counts |
| `GET /exams/{id}/announcements`, `POST /exams/{id}/announcements` | List; send to candidates |

Rules: a gap in contact of more than 45 seconds opens a `Disruption` row and sets the attempt to `INTERRUPTED`; the next contact closes it. Detection is lazy: the heartbeat handler notices its own gap, and the monitor endpoint sweeps the exam's attempts. Incident types from the exam page are limited to the client list in [API, section 3.2](api.md); the server sets the time and the source; the endpoint is rate-limited. The monitor endpoint must stay fast with hundreds of live attempts.

### C4. Integrity analysis (`examiner-integrity`)

`GET /attempts/{id}/integrity` returns the attempt's signals with a low, medium or high level; `PUT /attempts/{id}/integrity/review` records the examiner's conclusion. Server-side signals, written as incidents with `source = SERVER`: a hard question answered correctly in a few seconds; a written answer much longer than its typing count allows (flagged high as "paste block bypassed"); near-identical written answers or the same pattern of wrong choices between candidates; and the attempt's honeypot marker appearing in an answer. See [ADR 0010](adr/0010-integrity-signals.md).

### C5. Candidate import

`POST /import/candidates` creates candidate accounts from a file and enrols them in an exam. The upload returns a generated first password once for each new account. Existing active candidates keep their account and password.

## 7. Open questions for the product owner

| # | Question | Why it matters |
|---|---|---|
| 1 | The frontend prototype has an administrator screen that extends exam time after an outage. The agreed rule is that the deadline never moves. Which stands? | Affects monitoring and the 5.3 write-up |
| 2 | The prototype has the administrator arbitrating disputes referred by an examiner. The agreed rule is that the examiner alone decides, with no appeal. Which stands? | Affects the disputes module |
| 3 | Imported candidates receive a generated first password. The examiner sees it in the upload response and delivers it privately. | Resolved |
| 4 | Is a forgotten-password flow needed? There is no email service; today an administrator resets passwords | The prototype has the screens |
| 5 | Are platform settings (session length, password rules) wanted as editable values? | The prototype has the screen |
| 6 | Where is the application deployed, and from which accounts? | Required for submission |

## 8. Before submission

- [ ] Deployed and working, with migrations applied and test accounts seeded.
- [ ] README lists test credentials for each role and describes each implemented innovation challenge, with its design decisions and trade-offs.
- [ ] `ALLOWED_ORIGINS` set to the deployed frontend's origin.
- [ ] A full end-to-end demonstration path works: create an exam, enrol, attempt, grade, release, dispute, report.
- [ ] No commit, push, build or deployment after the deadline.
