import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const EXAM_COUNT = 250;
const CANDIDATE_COUNT = 4_000;
const LARGE_EXAM = "perf-enrol-exam-1";
let examiner: Client;
let candidate: Client;

async function clearFixtures() {
  await sql('DELETE FROM "Attempt" WHERE "examId" LIKE $1', ["perf-enrol-%"]);
  await sql('DELETE FROM "Exam" WHERE id LIKE $1', ["perf-enrol-%"]);
  await sql('DELETE FROM "User" WHERE id LIKE $1', ["perf-enrol-%"]);
}

before(async () => {
  await resetRateLimits();
  await clearFixtures();
  const accounts = await sql<{ id: string; email: string }>('SELECT id, email FROM "User" WHERE email IN ($1, $2)', [
    TEST_ACCOUNTS.examiner.email, TEST_ACCOUNTS.candidate.email,
  ]);
  const ownerId = accounts.find(({ email }) => email === TEST_ACCOUNTS.examiner.email)!.id;
  const candidateId = accounts.find(({ email }) => email === TEST_ACCOUNTS.candidate.email)!.id;

  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT 'perf-enrol-person-' || n, 'perf-enrol-person-' || n || '@exam.test', 'Candidate ' || n,
            'unused', 'CANDIDATE', now()
     FROM generate_series(1, $1::int) AS n`,
    [CANDIDATE_COUNT],
  );
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, "startsAt", "endsAt", "durationMinutes", "totalMarks", status, "updatedAt")
     SELECT 'perf-enrol-exam-' || n, $1, 'Exam ' || n, now() + interval '1 hour', now() + interval '2 hours',
            30, 50, 'PUBLISHED', now()
     FROM generate_series(1, $2::int) AS n`,
    [ownerId, EXAM_COUNT],
  );
  await sql(
    `INSERT INTO "Enrollment" (id, "examId", "candidateId", "enrolledById")
     SELECT 'perf-enrol-roster-' || exam || '-' || person,
            'perf-enrol-exam-' || exam, 'perf-enrol-person-' || person, $1
     FROM generate_series(1, $2::int) AS exam
     CROSS JOIN LATERAL generate_series(1, CASE WHEN exam = 1 THEN $3::int ELSE 100 END) AS person`,
    [ownerId, EXAM_COUNT, CANDIDATE_COUNT],
  );
  await sql(
    `INSERT INTO "Enrollment" (id, "examId", "candidateId", "enrolledById", "createdAt")
     SELECT id || '-candidate', id, $1, $2, now() - n * interval '1 minute'
     FROM generate_series(1, $3::int) AS n JOIN "Exam" ON id = 'perf-enrol-exam-' || n`,
    [candidateId, ownerId, EXAM_COUNT],
  );
  await sql(
    `INSERT INTO "RetakeGrant" (id, "examId", "candidateId", "startsAt", "endsAt", reason, "grantedById")
     SELECT 'perf-enrol-grant-' || n, $1, 'perf-enrol-person-' || n,
            now() + interval '3 hours', now() + interval '4 hours', 'Approved slot', $2
     FROM generate_series(1, $3::int) AS n`,
    [LARGE_EXAM, ownerId, 2_500],
  );
  await sql(
    `INSERT INTO "RetakeGrant" (id, "examId", "candidateId", "startsAt", "endsAt", reason, "grantedById")
     SELECT id || '-grant', id, $1, now() + interval '3 hours', now() + interval '4 hours', 'Approved slot', $2
     FROM "Exam" WHERE id LIKE 'perf-enrol-exam-%'`,
    [candidateId, ownerId],
  );
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", status, "deadlineAt", "rulesAcceptedAt", "maxScore")
     SELECT id || '-attempt-' || n, id, $1, n, 'SUBMITTED', now() - interval '1 hour', now() - interval '2 hours', 50
     FROM "Exam" CROSS JOIN generate_series(1, 6) AS n WHERE id LIKE 'perf-enrol-exam-%'`,
    [candidateId],
  );
  await sql('ANALYZE "Exam", "Enrollment", "RetakeGrant", "Attempt"');
  examiner = await signInAs("examiner");
  candidate = await signInAs("candidate");
});

after(async () => {
  try {
    await clearFixtures();
  } finally {
    await closeDatabase();
  }
});

async function measure(client: Client, path: string, budget: number) {
  const samples: number[] = [];
  for (let run = 0; run < 45; run++) {
    const start = performance.now();
    const result = await client.get(path);
    const elapsed = performance.now() - start;
    assert.equal(result.status, 200, result.text.slice(0, 200));
    if (run >= 5) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  const median = samples[20];
  const p95 = samples[38];
  console.log(`${path}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, budget ${budget} ms`);
  assert.ok(p95 <= budget, `${path}: p95 ${p95.toFixed(1)} ms exceeds the ${budget} ms budget`);
}

describe("enrolment read times at volume", () => {
  it("reads a page of a 4,001-candidate roster", () => measure(examiner, `/exams/${LARGE_EXAM}/enrollments?page=40&pageSize=100`, 65));
  it("reads the examiner's retake history", () => measure(examiner, `/exams/${LARGE_EXAM}/retake-grants?pageSize=100`, 65));
  it("lists candidate exams with attempt counts grouped by slot", () => measure(candidate, "/me/exams?pageSize=100", 85));
  it("reads one candidate exam with its availability and rules", () => measure(candidate, `/me/exams/${LARGE_EXAM}`, 50));
});
