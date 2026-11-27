# Testing

| | |
|---|---|
| Status | In use. Every module ships with end-to-end tests |
| Related | [Architecture](architecture.md), [Security](security.md) |

## 1. Levels

| Level | What it covers | Where | Command |
|---|---|---|---|
| Unit | Pure logic with no server or database, such as password hashing | `src/**/*.test.ts` | `npm run test:unit` |
| End-to-end | Every endpoint over HTTP against a production build and a real PostgreSQL database | `tests/e2e/*.test.ts` | `npm run test:e2e` |
| Static | Lint and type-check | whole repository | `npm run lint`, `npm run typecheck` |

End-to-end tests are the main line of defence. They exercise the route handler, validation, guards, service, database constraints and response headers together, which is where security and integrity rules actually live.

## 2. How the end-to-end run works

`npm run test:e2e` runs `tests/run-e2e.ts`, which:

1. Creates a separate database with the suffix `_test`, so development data is never touched.
2. Applies migrations and seeds the test accounts.
3. Builds the application and starts it in production mode on port 3100.
4. Runs the test files one at a time, because they share one database and its rate limits.
5. Stops the server.

Useful settings:

| Variable | Effect |
|---|---|
| `E2E_SKIP_BUILD=1` | Reuse the existing production build |
| `E2E_BASE_URL` | Test a server that is already running, which must use the same database |
| `E2E_DATABASE_URL` | Use this database as is |

The tests behave like a browser: they keep cookies between requests and send an `Origin` header where the scenario needs one. They use a direct database connection only to arrange state (for example, expiring a session) and to check what was stored (for example, that a password is hashed).

Rate limits stay switched on. Each test clears the counters first, so the limits themselves can be tested.

## 3. What every module's tests must cover

| Area | Cases |
|---|---|
| Access | No session, each wrong role, and another user's record |
| Validation | Each field's bounds, wrong types, unknown fields, missing fields |
| Hostile input | Injection-shaped strings, wildcard characters, NUL characters, oversized bodies, path tricks in ids |
| State | Repeated requests, the same request racing itself, actions after the state has changed |
| Data exposure | Response fields are exactly the documented ones; no password, hash or answer key |
| Storage | What was written matches the request; audit entries exist and hold no secrets |
| Limits | Rate limits trigger, apply to the right key, and release |

## 4. Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on every push to `main`: lint, type-check, unit tests, a dependency audit, then the build and the full end-to-end run against a PostgreSQL service container.

## 5. Bugs the tests have caught

| Bug | Found by | Fix |
|---|---|---|
| A `%` in the user search matched every user, and `_` matched any character | Wildcard search test | Search terms are escaped and treated as literal text |
| The dependency audit reported three high-severity advisories through the Prisma command-line tool | CI audit step | The affected package is pinned to its patched release with an npm override |
| A NUL character in a user id caused a 500 response | Hostile id test | Ids are checked before any query; NUL characters in bodies and query strings are refused with 400 |
