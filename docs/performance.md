# Read performance

| | |
|---|---|
| Status | Measured for the administrator endpoints. Each module adds its reads to the measurement suite |
| Related | [Testing](testing.md), [Data model](data-model.md) |

## 1. Approach

Read time is treated as a requirement, not something to tune later.

1. Load the tables to a realistic large size.
2. Measure every read endpoint over HTTP against a production build.
3. Look at the query plan for anything slow, and fix the cause.
4. Keep the measurement as a repeatable suite with a time budget per endpoint, so a regression fails it.

`npm run test:perf` does this. It loads 50,000 users and 300,000 audit entries into the test database, takes 40 samples per endpoint after a warm-up, prints the median and 95th percentile, fails if any 95th percentile is over its budget, and removes the data again. It is not part of CI, because timings depend on the machine.

## 2. Results

Measured on a developer laptop with PostgreSQL 16 in Docker; times are for the whole HTTP request in milliseconds.

| Read | Median before | Median after | 95th percentile after |
|---|---|---|---|
| Current user (`GET /auth/me`, runs on every request) | 1.7 | 1.8 | 4.0 |
| User list, first page | 10.2 | 3.9 | 5.2 |
| User list, filtered by role | 2.4 | 3.8 | 6.7 |
| User list, page 2,000 | 19.3 | 6.1 | 7.7 |
| User search by name | 27.5 | 27.3 | 30.7 |
| User search by email | 27.5 | 27.8 | 32.9 |
| One user | 1.8 | 1.9 | 3.3 |
| Platform overview | 14.1 | 5.5 | 6.2 |
| Audit log, first page | 22.3 | 2.0 | 4.5 |
| Audit log, first page with a total | 22.3 | 19.8 | 23.0 |
| Audit log, 200,000 entries deep | 20.1 (first attempt) | 2.3 | 3.5 |
| Audit log, by action | 19.7 | 2.3 | 4.9 |
| Audit log, by actor | 2.0 | 1.6 | 1.9 |
| Audit log, by record | 2.3 | 1.6 | 1.9 |
| Audit log, by time range | 14.1 | 1.7 | 2.1 |

## 3. What was changed and why

| Change | Reason, from the query plan |
|---|---|
| Index on `AuditLog (createdAt desc, id desc)` | Newest-first reading sorted 300,000 rows on every request. With the index the rows come out in order and the read stops after one page |
| Index on `AuditLog (action, createdAt desc)` | Filtering by action, and the overview's "failed sign-ins in 24 hours", scanned the whole log |
| Index on `User (createdAt desc, id)` | The user list sorted every user to return 20 |
| Cursor paging for the audit log | Page numbers make the database read and discard every earlier row. A cursor starts where the last page ended, so depth costs nothing |
| An explicit `createdAt <= cursor` bound in the cursor query | Without it, PostgreSQL walked the index from the newest entry and filtered 190,000 rows (47 ms). With it, the scan starts at the cursor (0.05 ms) |
| The audit log total is opt-in (`withTotal=true`) | Counting 300,000 rows takes about 13 ms and was most of the first page's time. It is skipped unless the screen shows a count |
| Expired sessions are deleted at sign-in; stale rate-limit counters are deleted occasionally | These tables are read on every request or sign-in. Keeping them small keeps those reads flat without a background job |

## 4. What was tried and rejected

**Trigram indexes for name and email search.** They were built and measured. At 50,000 users PostgreSQL does not choose them: its estimate for reading two trigram indexes is higher than for reading the table, and forcing them saved only about 13 ms. They would also make every sign-up and user update slower. Search stays a sequential read at about 27 ms. This should be revisited at roughly half a million users, where the balance changes.

## 5. Rules for new modules

- Every list is paged and has a maximum page size.
- A list that can grow without bound uses cursor paging and an index matching its sort order. Bounded lists may use page numbers.
- A total is counted only when the screen needs it.
- Select only the columns the response returns.
- Fetch related rows in one query with the parent, never one query per row.
- Add each new read endpoint to `tests/perf` with a budget, at a volume that reflects real use.
- Check the plan with `EXPLAIN ANALYZE` before adding an index, and measure again afterwards. An index that is not used is removed.

## 6. Deliberate costs

| Cost | Why it is accepted |
|---|---|
| Sign-in takes about 150 to 300 ms | Password hashing is slow on purpose, to make stolen hashes expensive to crack |
| One session lookup per request (about 2 ms) | It is what allows a session to be ended instantly |
| Name and email search reads every user | See section 4 |
