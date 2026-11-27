# Secure Examination Management System

Web-e-Thon entry (Technoverse 5.0). A full-stack application for creating, conducting, monitoring and evaluating online examinations.

## Stack

- Next.js 16 (App Router) and React 19, TypeScript
- Tailwind CSS 4
- PostgreSQL 16 with Prisma 7

## Local setup

Requirements: Node.js 22 or newer, and Docker.

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run db:seed
npm run dev
```

The app runs at http://localhost:3000. `GET /api/v1/health` reports whether the server can reach the database.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run lint` | Lint the code |
| `npm run db:up` | Start the local PostgreSQL container (port 5434) |
| `npm run db:migrate` | Apply schema changes and create a migration |
| `npm run db:seed` | Create or reset the test accounts |
| `npm run db:studio` | Browse the database |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Build, then run every end-to-end test against a separate test database |
| `npm run test:perf` | Measure read times against large tables |
| `npm run typecheck` | Type-check |

## Documentation

New contributors: start with [`docs/contributing.md`](docs/contributing.md) and [`docs/roadmap.md`](docs/roadmap.md).

Design documents are in [`docs/`](docs/README.md): architecture (C4), data model with data dictionary, API, security threat model, testing and decision records.

Every pull request runs lint, type-check, unit tests, a dependency audit and the full end-to-end suite in CI.

### For the UI team

[`docs/openapi.yaml`](docs/openapi.yaml) is the API reference: every built endpoint, its request and response shapes, and notes on cookies, errors, rate limits and role routing. It is updated with every module, and a test fails if it falls out of step with the code. To browse it:

```bash
npx @redocly/cli preview --api docs/openapi.yaml
```

Or paste the file into any OpenAPI viewer.

## Test accounts

Fictional accounts created by `npm run db:seed`. Running it again resets them.

| Role | Email | Password |
|---|---|---|
| Administrator | `admin@exam.test` | `Admin-Demo-2026` |
| Examiner | `examiner@exam.test` | `Examiner-Demo-2026` |
| Candidate | `candidate@exam.test` | `Candidate-Demo-2026` |
| Candidate | `candidate2@exam.test` | `Candidate-Demo-2026` |

Sign in with `POST /api/v1/auth/login` and a JSON body of `email` and `password`. The session is kept in an `HttpOnly` cookie. The role is read from the account, so the same sign-in serves every user type.

New candidates and examiners can register with `POST /api/v1/auth/signup` (`email`, `name`, `password`, and `role` of `CANDIDATE` or `EXAMINER`). Administrator accounts cannot be registered.

## Status

| Module | State |
|---|---|
| Platform foundation | Built |
| Auth and sessions | Built |
| User management | Built |
| Administrator overview and audit log | Built |
| Question bank (topics and questions) | Built |
| Shared paper and scoring rules | Built |
| Question import (CSV and JSON) | Built |
| Grading | Built |
| Exams (drafts, paper review, publication and join codes) | Built |
| Candidate workspace preferences | Built |
| Enrolment (rosters, joining by code and retake grants) | Built |
| Attempts (paper delivery, autosave, grading handoff and sandbox) | Built |
| Examiner monitoring, disruptions and announcements | Built |
| Results and analytics | Built |
| Post-submission integrity signals and examiner review | Built |
| Candidate import (CSV and JSON) | Built |
| Candidate disputes | Built |
| Reports | Designed, not built |

**5.1 Integrity review.** After submission, the examiner can review server-recorded signals for timing, typing counts, similar responses, and the attempt's marker. The examiner can save a review note in the same view.

Balanced papers (5.2) use largest remainders to translate difficulty percentages into question counts. Draws rotate across topics within each difficulty. Every paper follows the same difficulty mix and total marks. A candidate’s questions and marking scheme are frozen when their attempt starts.

**5.3 Disruption resilience.** Candidate heartbeats and examiner polling record contact gaps over 45 seconds. Candidates reconnect on the same fixed deadline. Examiners can see when contact was lost and restored.
