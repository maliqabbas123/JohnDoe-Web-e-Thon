# API

| | |
|---|---|
| Status | Conventions are final. Built so far: Platform, Auth, Users and Admin. The rest of the endpoint list is the plan; an OpenAPI 3.1 file will be added as endpoints are built |
| Base path | `/api/v1` |
| Related | [Architecture](architecture.md), [Security](security.md) |

## 1. Conventions

- JSON request and response bodies, UTF-8.
- Authentication by session cookie. Send requests with credentials included.
- All times are ISO 8601 in UTC, for example `2026-11-28T09:00:00.000Z`.
- Responses are never cached (`Cache-Control: no-store`).
- State-changing requests from a browser must come from the application's own origin or one listed in `ALLOWED_ORIGINS`.

### Success

```json
{ "data": { "id": "..." } }
```

Lists add paging information:

```json
{ "data": [], "meta": { "page": 1, "pageSize": 20, "total": 0 } }
```

### Failure

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Some fields are invalid.", "details": [{ "path": "email", "message": "Enter a valid email address." }] } }
```

| Status | Code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request or body |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `FORBIDDEN` | Role, ownership or origin check failed |
| 404 | `NOT_FOUND` | Missing, or not visible to this user |
| 409 | `CONFLICT` | State conflict: duplicate, attempt closed, window not open |
| 413 | `PAYLOAD_TOO_LARGE` | Body or file over the limit |
| 422 | `VALIDATION_FAILED` | Input failed validation; `details` lists fields |
| 429 | `RATE_LIMITED` | Too many requests; see `Retry-After` |
| 500 | `INTERNAL` | Unexpected error; no detail is returned |

## 2. Endpoints

Roles: **A** administrator, **E** examiner, **C** candidate, **P** public.

| Module | Method and path | Roles | Purpose |
|---|---|---|---|
| Platform | `GET /health` | P | Service and database status |
| Auth | `POST /auth/signup` | P | Register as a candidate or examiner and sign in |
| | `POST /auth/login` | P | Sign in; the role is read from the account |
| | `POST /auth/logout` | A E C | Sign out |
| | `GET /auth/me` | A E C | Current user |
| | `POST /auth/change-password` | A E C | Change own password |
| Users | `GET /users`, `POST /users` | A | List and create accounts |
| | `GET /users/{id}`, `PATCH /users/{id}` | A | Read; change name, role, activation, password |
| Admin | `GET /admin/overview` | A | Platform counts: users, exams, attempts, disputes, sessions, failed sign-ins |
| | `GET /admin/audit-logs` | A | Audit log with filters by actor, action, record and time range |
| Questions | `GET /topics`, `POST /topics` | E | Topics in own bank |
| | `GET /questions`, `POST /questions` | E | List with filters; create |
| | `GET /questions/{id}`, `PATCH /questions/{id}`, `DELETE /questions/{id}` | E | Read, edit, archive |
| Exams | `GET /exams`, `POST /exams` | E | Own exams; create |
| | `GET /exams/{id}`, `PATCH /exams/{id}` | E | Read; edit settings |
| | `PUT /exams/{id}/questions` | E | Set the question pool |
| | `PUT /exams/{id}/difficulty-rules` | E | Set the difficulty mix |
| | `GET /exams/{id}/review` | E | Pre-publish checks and resulting counts |
| | `POST /exams/{id}/publish`, `POST /exams/{id}/complete` | E | Lifecycle |
| Enrolment | `GET /exams/{id}/enrollments`, `POST /exams/{id}/enrollments` | E | List; enrol candidates |
| | `DELETE /exams/{id}/enrollments/{candidateId}` | E | Remove before the first attempt |
| | `POST /exams/{id}/retake-grants` | E | Give candidates an extra slot |
| | `POST /me/exams/join` | C | Enrol in an exam with its join code |
| | `GET /me/exams` | C | Own upcoming, available, in-progress and completed exams |
| | `GET /me/exams/{id}` | C | Instructions, rules and own status |
| Attempts | `POST /exams/{id}/attempts` | C | Start (requires accepting the rules) |
| | `GET /attempts/{id}` | C | Status, deadline, server time, question states |
| | `GET /attempts/{id}/questions/{position}` | C | One question, without the answer key |
| | `PUT /attempts/{id}/answers/{position}` | C | Save an answer or review flag |
| | `PUT /attempts/{id}/scratchpad` | C | Save rough work |
| | `POST /attempts/{id}/heartbeat` | C | Contact signal; returns server time and announcements |
| | `POST /attempts/{id}/submit` | C | Submit |
| | `POST /exams/{id}/sandbox`, `DELETE /exams/{id}/sandbox` | E | Preview as a candidate; reset |
| Monitoring | `GET /exams/{id}/monitor` | E | Live attempts, progress, connection, incidents |
| | `POST /attempts/{id}/incidents` | C | Report exam-page events |
| | `GET /exams/{id}/announcements`, `POST /exams/{id}/announcements` | E | List; send |
| Grading | `GET /exams/{id}/grading` | E | Answers waiting for a mark |
| | `PATCH /attempts/{id}/answers/{position}/grade` | E | Mark a written answer |
| Integrity | `GET /attempts/{id}/integrity` | E | Signal summary for one attempt |
| | `PUT /attempts/{id}/integrity/review` | E | Record the examiner's conclusion |
| Results | `GET /exams/{id}/results` | E | Scores before and after release |
| | `POST /exams/{id}/results/release` | E | Release results |
| | `GET /me/results`, `GET /me/results/{attemptId}` | C | Own released results and attempt review |
| | `GET /exams/{id}/analytics` | E | Exam statistics and fairness report |
| | `GET /exams/{id}/analytics/questions` | E | Per-question statistics |
| Disputes | `POST /attempts/{id}/disputes` | C | Raise, with an optional document |
| | `GET /me/disputes` | C | Own disputes and decisions |
| | `GET /exams/{id}/disputes`, `GET /disputes/{id}` | E | Review queue; detail with evidence |
| | `PATCH /disputes/{id}/items/{itemId}` | E | Decide one item |
| | `GET /disputes/{id}/attachment` | E C | Download the document |
| Reports | `POST /attempts/{id}/report` | E | Issue a verifiable report |
| | `GET /attempts/{id}/report.pdf` | E C | Download |
| | `GET /verify/{code}` | P | Check a report |
| Import | `POST /import/candidates`, `POST /import/questions` | E | Bulk import from CSV or JSON |
| | `GET /import/jobs` | E | Past imports with row errors |
| Workspace | `GET /me/preferences`, `PUT /me/preferences` | C | Exam workspace settings |

## 3. Contract for the exam page

The frontend's exam page is responsible for the following. The server works without them but records less.

### 3.1 Calls

| When | Call |
|---|---|
| Every 15 seconds while an attempt is open | `POST /attempts/{id}/heartbeat` |
| On each navigation | `GET /attempts/{id}/questions/{position}`; keep only this question in memory |
| On each answer change, debounced | `PUT /attempts/{id}/answers/{position}` with an increasing `revision` and the typing counts |
| On each event in 3.2 | `POST /attempts/{id}/incidents` |

Use the `serverTime` and `deadlineAt` from responses to run the countdown. Never use the device clock for the deadline.

### 3.2 Incident events

Sent only when the matching exam switch is on.

| Type | Send when | Details |
|---|---|---|
| `TAB_HIDDEN` | The page becomes hidden | `awayMs` when it returns |
| `FOCUS_LOST` | The window loses focus | `awayMs` when it returns |
| `FULLSCREEN_EXIT` | Full screen is left | |
| `COPY_ATTEMPT` | A copy or cut is blocked | `position` |
| `PASTE_ATTEMPT` | A paste is blocked | `position` |
| `CONTEXT_MENU` | A right-click is blocked | |
| `DEVTOOLS_SHORTCUT` | An inspect shortcut is blocked | `key` |
| `PRINT_SCREEN` | The Print Screen key is pressed | |
| `EXTRA_DISPLAY` | More than one display is detected | |

The server adds its own: `CONCURRENT_SESSION`, `NETWORK_CHANGE`, `FAST_CORRECT_ANSWER`, `PASTE_BYPASS`, `SIMILAR_ANSWER`, `HONEYPOT_TRIGGERED`.

### 3.3 Rules shown before starting

`GET /me/exams/{id}` returns a `rules` object generated from the exam's settings: slot, duration, attempts allowed and used, best-or-latest policy, marking scheme, randomisation, each active integrity switch, what is recorded, and the deadline policy. The page must show it and send `rulesAccepted: true` to start.
