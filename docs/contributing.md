# Contributing

How work is done in this repository. Read this before your first change, together with [Architecture](architecture.md) and [Roadmap](roadmap.md).

## 1. Set up

Requirements: Node.js 22 or newer, and PostgreSQL 16.

```bash
npm install
cp .env.example .env
npm run db:up        # PostgreSQL in Docker on port 5434
npm run db:migrate
npm run db:seed
npm run dev
```

Without Docker, use any PostgreSQL 16 server: create a database and a user that owns it, and put its URL in `.env` as `DATABASE_URL`. The user needs permission to create databases, because the tests create a sibling database with the suffix `_test`.

## 2. Workflow

1. Start from an up-to-date `main`.
2. One branch per module, named by area: `admin-…`, `examiner-…`, `candidate-…`, `docs-…`, `test-…`. Example: `examiner-exams`.
3. Build the module with its tests, read-time checks and API reference (section 3).
4. Rebase on `main`, run every check locally, open a pull request.
5. Merge with a merge commit once CI is green. Never merge a red build.

Keep pull requests to one module. If you find a bug elsewhere, fix it in its own small pull request.

## 3. Definition of done

A module is finished when all of these are true:

- [ ] Route handlers contain no business logic; services contain no request or response objects.
- [ ] Every handler is wrapped in `route()` and starts with `requireUser()` or `requireRole()`.
- [ ] Every input is parsed by a strict Zod schema.
- [ ] End-to-end tests cover the cases in [Testing, section 3](testing.md#3-what-every-modules-tests-must-cover).
- [ ] Every new read endpoint is in `tests/perf` with a budget, measured at a realistic volume.
- [ ] `docs/openapi.yaml` describes every new operation, with UI notes.
- [ ] `docs/api.md` status line and the README status table are updated.
- [ ] `docs/security.md` statuses are updated if a planned control is now built.
- [ ] `npm run lint`, `npm run typecheck`, `npm run test:unit` and `npm run test:e2e` pass.

## 4. Code conventions

### Layers

| Layer | Location | Does | Does not |
|---|---|---|---|
| Route handler | `src/app/api/v1/**/route.ts` | Guard, parse input, call one service function, shape the response | Hold rules, query the database |
| Service | `src/server/modules/<module>/service.ts` | Rules, ownership checks, transactions | Touch the request or build responses |
| Schemas | `src/server/modules/<module>/schemas.ts` | Zod schemas and their inferred types | |
| Shared exam rules | `src/server/exam/` | Pure functions used by several modules, such as scoring | Access the database |

A handler looks like this:

```ts
export const POST = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const input = createThingSchema.parse(await readJson(request));
  return created(await createThing(examiner, input));
});
```

### Rules that protect security

- **Identity comes from the session only.** Never read a user id or role from the body, query or path to decide who is acting.
- **Ownership is checked in the query**, for example `where: { id, ownerId: user.id }`. A record that belongs to someone else is reported as **404**, not 403, so its existence is not revealed.
- **Schemas are strict** (`z.strictObject`) so unknown fields are rejected. This is what stops a client sending `role`, `ownerId` or `isActive`.
- **Select fields explicitly.** Never return a whole database row. Password hashes, session token hashes and answer keys must not be selectable by accident.
- **Candidates never receive `isCorrect`.** Build candidate responses with `toCandidateQuestion()` from `src/server/exam/paper.ts`.
- **Path ids go through `resourceId()`** and query strings through `readQuery()`; bodies through `readJson()`. These refuse malformed ids, NUL characters and oversized bodies before any query runs.
- **Search terms are literal.** Escape `%`, `_` and `\` before a `contains` filter (see `literal()` in the users and questions services).
- **No string-built SQL.** Use Prisma, or tagged-template `$queryRaw` with parameters.
- **Time is the server's.** Never trust a time sent by a client for a deadline or an ordering.
- **Changes that must happen together run in one transaction**, including their audit entry.

### Errors and responses

- Throw `errors.*` from `src/server/http/errors.ts` for expected failures. Anything else becomes a generic 500.
- Return `ok()`, `created()`, `page()`, `cursorPage()` or `noContent()` from `src/server/http/response.ts`.
- Marks are stored as exact decimals; convert with `Number()` when returning them.

### Sensitive actions

Write an audit entry with `writeAudit()` for sign-ins, account changes, grade changes, result release, retake grants and dispute decisions. Never put a password, token or answer key in audit metadata. Add the action name to the `AuditAction` list in `docs/openapi.yaml`; a unit test fails if you forget.

## 5. Tests

- End-to-end tests live in `tests/e2e`, one file per module, and use `tests/e2e/helpers.ts`.
- Create accounts with `createTempUser(role)`; they are removed afterwards together with what they own. If your module adds tables that reference a user with a restricting foreign key, extend `removeTempUsers()`.
- Sign in as a seeded account with `signInAs("admin" | "examiner" | "candidate" | "candidate2")`. A new sign-in ends that account's previous session, so do not hold two clients for one seeded account.
- Rate limits are real in tests. Reset them with `resetRateLimits()` in `beforeEach`.
- To test a module before the modules it depends on exist, insert the rows it needs with `sql()`. The schema for every module is already migrated.
- Every list endpoint needs a read-time check in `tests/perf` with a budget. Look at the query plan before adding an index, and remove an index the planner does not use.

## 6. API reference

`docs/openapi.yaml` is what the UI team builds against.

- Add each operation in the same pull request as its code. A unit test compares the document with the route handlers and fails on any difference.
- Every operation needs an `operationId`, a summary, a description, exactly one tag and its responses. Protected operations document 401; state-changing operations document 403.
- Put anything a frontend developer must know in the description under **UI notes**: when to call it, what each failure means for the screen, limits, and traps.
- Bump `info.version` with each module.

## 7. Database changes

- Change `prisma/schema.prisma`, then run `npx prisma migrate dev --create-only --name <what_changed>`, read the generated SQL, and apply it with `npx prisma migrate dev`.
- One migration per pull request. Never edit a migration that is already on `main`.
- Constraints Prisma cannot express (partial indexes, check constraints) are written by hand in the migration file. See the first migration for examples.
- If two branches both add a migration, the second to merge must rebase and re-run its migration against a fresh database before merging.

## 8. Files that several people edit

These cause merge conflicts when work runs in parallel. Keep your change in them small and rebase before opening a pull request.

| File | How to keep conflicts small |
|---|---|
| `docs/openapi.yaml` | Add your paths in one block next to related ones; add schemas together at one place |
| `docs/api.md`, `README.md` | Touch only your module's line |
| `prisma/schema.prisma` | Change only your module's models |
| `tests/e2e/helpers.ts` | Add helpers; do not change existing ones |
| `docs/performance.md`, `docs/security.md` | Add a section or change one status |

## 9. Things that will trip you up

| Topic | What to know |
|---|---|
| Next.js 16 | This version differs from older ones. Read the guide in `node_modules/next/dist/docs/` for anything you are unsure of. Middleware is now `src/proxy.ts`. Route params are a promise: `(await params).id` |
| Request-time handlers | `route()` calls `connection()` so handlers are never prerendered at build time. Do not remove it |
| Type-checking | `npm run typecheck` runs `next typegen` first. Plain `tsc` fails on a fresh checkout |
| Prisma 7 | The config file is `prisma7.config.ts`. The client is generated into `src/generated/prisma` (not committed) and needs the `pg` adapter, as in `src/server/db.ts`. `migrate dev` does not regenerate the client; run `npx prisma generate` |
| `server-only` | Files that import it cannot be loaded by tests or scripts. Keep pure logic in files without it, as `src/server/auth/password.ts` and `src/server/exam/paper.ts` do |
| Development server | After switching branches, restart `npm run dev`; it can hold stale modules |
| End-to-end run | It builds the app and starts it on port 3100 against the `_test` database with `ALLOWED_ORIGINS=https://frontend.example`. Use `E2E_SKIP_BUILD=1` to reuse a build when only tests changed |
| Cookies in production | The session cookie is `Secure`. Test clients must send it back themselves over plain HTTP, as the helper does |
| One session per user | Signing in again ends the earlier session. This surprises tests that reuse an account |
