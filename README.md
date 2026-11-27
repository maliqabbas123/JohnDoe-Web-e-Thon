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
| `npm run typecheck` | Type-check |

## Documentation

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
| Question bank, exams, enrolment, attempts, monitoring, grading, results, reports, import, disputes, integrity | Designed, not built |

The innovation challenge write-up is added with the modules that implement it.
