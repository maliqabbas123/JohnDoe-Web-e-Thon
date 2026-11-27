import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "../e2e/evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const PEERS = 149;
const BUDGET_MS = 200;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let examiner: Client;
let attempt: string;

const removeCandidates = () => sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-integrity-%'`);

before(async () => {
  await resetRateLimits();
  await removeCandidates();
  const [owner] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [user] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  exam = await seedEvaluationExam(owner.id, 10);
  attempt = await seedEvaluationAttempt(exam, user.id);
  await sql(`INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
    SELECT 'e2e-perf-integrity-' || n, 'e2e-perf-integrity-' || n || '@exam.test', 'Peer', 'fixture', 'CANDIDATE', now()
    FROM generate_series(1, $1::int) n`, [PEERS]);
  await sql(`INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", status, "startedAt", "deadlineAt",
    "rulesAcceptedAt", "submittedAt", "maxScore")
    SELECT id || '-attempt', $1, id, 1, 'SUBMITTED', now() - interval '15 minutes', now() + interval '15 minutes',
      now() - interval '15 minutes', now(), $2
    FROM "User" WHERE id LIKE 'e2e-perf-integrity-%'`, [exam.id, exam.totalMarks]);
  const text = "Repeated trials make experimental measurements more dependable by revealing variation that would not be visible after a single measurement.";
  await sql(`UPDATE "AttemptQuestion" SET "writtenAnswer" = $2
    WHERE "attemptId" = $1 AND snapshot->>'type' = 'WRITTEN'`, [attempt, text]);
  await sql(`INSERT INTO "AttemptQuestion" (id, "attemptId", "questionId", position, marks, snapshot, "optionOrder",
    "selectedOptionIds", "writtenAnswer")
    SELECT a.id || '-q-' || q.position, a.id, q."questionId", q.position, q.marks, q.snapshot, q."optionOrder",
      q."selectedOptionIds", q."writtenAnswer"
    FROM "Attempt" a CROSS JOIN "AttemptQuestion" q
    WHERE a."examId" = $1 AND a.id <> $2 AND q."attemptId" = $2`, [exam.id, attempt]);
  examiner = await signInAs("examiner");
});
after(async () => {
  if (exam) await removeEvaluationExam(exam);
  await removeCandidates();
  await resetRateLimits();
  await closeDatabase();
});

it("analyzes a class of 150 attempts within the read budget", async () => {
  const path = "/attempts/" + attempt + "/integrity";
  for (let warm = 0; warm < 3; warm++) assert.equal((await examiner.get(path)).status, 200);
  const samples: number[] = [];
  for (let sample = 0; sample < 20; sample++) {
    const start = performance.now();
    const response = await examiner.get(path);
    samples.push(performance.now() - start);
    assert.equal(response.status, 200, response.text);
    assert.ok(response.body.data.counts.MEDIUM > 0);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
  console.log("GET /attempts/{id}/integrity — p95 " + p95.toFixed(1) + " ms");
  assert.ok(p95 <= BUDGET_MS, "Integrity p95 exceeds the " + BUDGET_MS + " ms budget");
});
