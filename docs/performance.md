# Read performance

| | |
|---|---|
| Status | Measured for the administrator endpoints, question bank, import history, exams, workspace preferences and enrolment. Each module adds its reads to the measurement suite |
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

### Question bank

Measured with 152,000 questions across 301 examiners, where the signed-in examiner owns 2,000.

| Read | Median | 95th percentile |
|---|---|---|
| Topics with counts per difficulty | 2.6 | 6.6 |
| Question list, first page | 3.3 | 5.4 |
| Question list, 100 per page | 4.8 | 7.6 |
| Question list, last page | 3.2 | 4.8 |
| Question list, by topic and difficulty | 2.6 | 3.5 |
| Question search | 3.4 | 4.6 |
| One question | 2.1 | 3.9 |

No index was added. Every query is scoped to the owner, and the existing index on `Question (ownerId, topicId, difficulty)` narrows it to that examiner's rows before anything else happens, so the size of the platform does not affect an examiner's reads.

### Question import history

Measured with 20,500 import jobs across 201 examiners, including 500 for the signed-in examiner. Each page includes row errors and uses the existing `ImportJob (userId, createdAt)` index for the owner and cursor bounds.

| Read | Median | 95th percentile | 95th percentile budget |
|---|---|---|---|
| Import jobs, first page | 4.6 ms | 5.7 ms | 30 ms |
| Import jobs, after 400 entries with 50 per page | 5.4 ms | 7.0 ms | 30 ms |

### Exams

Measured with 32,000 exams across 301 examiners. The signed-in examiner owned 2,000 exams, and the detail and review endpoints used a 500-question pool. The review calculated a 60-question balanced paper.

| Read | Median (ms) | 95th percentile (ms) | Budget (ms) |
|---|---:|---:|---:|
| Exams, first page | 9.9 | 14.8 | 50 |
| Upcoming published exams, page 10 with 100 per page | 11.5 | 14.1 | 70 |
| Exam detail | 16.5 | 22.6 | 80 |
| Exam review | 12.7 | 21.4 | 70 |

### Candidate workspace preferences

Measured with 20,001 saved preference records. The request reads one row by the signed-in candidate's primary key.

| Read | Median | 95th percentile | 95th percentile budget |
|---|---|---|---|
| `GET /me/preferences` | 4.9 ms | 7.2 ms | 20 ms |

### Enrolment

Measured with 29,150 enrolments across 250 exams. The largest roster held 4,001 candidates and 2,501 grants. The signed-in candidate had 250 enrolments and 1,500 previous attempts.

| Read | Median (ms) | 95th percentile (ms) | Budget (ms) |
|---|---:|---:|---:|
| Roster, page 40 with 100 per page | 14.1 | 16.6 | 65 |
| Retake grants, first 100 | 12.6 | 16.5 | 65 |
| Candidate exams, first 100 | 16.3 | 19.1 | 85 |
| Candidate exam details | 7.9 | 9.3 | 50 |

### Examiner monitoring

Measured with 500 active attempts, 20 frozen questions per attempt, and
200 announcements. The monitor reads the first page of 100 attempts.

| Read | Median | 95th percentile | 95th percentile budget |
|---|---|---|---|
| `POST /attempts/{id}/heartbeat` | 9.1 ms | 11.0 ms | 35 ms |
| `GET /exams/{id}/monitor` | 12.1 ms | 16.5 ms | 80 ms |
| `GET /exams/{id}/announcements` | 6.8 ms | 8.3 ms | 30 ms |

### Examiner integrity

With 150 closed attempts and ten answers each, `GET /attempts/{id}/integrity`
measured 63.8 ms p95 against a 200 ms budget. Each read compares at most
4,000 peer answers from 200 candidates.

### Attempts

Measured with 601 simultaneous active attempts and 20 questions per paper.

| Read or save | Median (ms) | 95th percentile (ms) | Budget (ms) |
|---|---:|---:|---:|
| Attempt status | 8.8 | 11.2 | 55 |
| Question delivery and navigation | 9.7 | 13.8 | 65 |
| Answer autosave | 9.0 | 11.2 | 65 |

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
