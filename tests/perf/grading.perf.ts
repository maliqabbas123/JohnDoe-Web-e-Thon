import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "../e2e/evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const ATTEMPTS = 500;
const QUESTIONS_PER_PAPER = 50;
const SAMPLES = 40;

let examiner: Client;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let exampleAttempt: string;

before(async () => {
  await resetRateLimits();
  const [{ id: ownerId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [{ id: candidateId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  exam = await seedEvaluationExam(ownerId, QUESTIONS_PER_PAPER);
  exampleAttempt = await seedEvaluationAttempt(exam, candidateId);

  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT $1 || '-perf-user-' || n, $1 || '-perf-user-' || n || '@exam.test', 'Candidate ' || n,
            'fixture', 'CANDIDATE', now()
     FROM generate_series(1, $2::int) n`,
    [exam.id, ATTEMPTS - 1],
  );
  await sql(
    `INSERT INTO "Enrollment" (id, "examId", "candidateId", "enrolledById")
     SELECT u.id || '-enrolled', $1, u.id, $2 FROM "User" u WHERE u.id LIKE ($1 || '-perf-user-%')`,
    [exam.id, ownerId],
  );
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", status, "gradingStatus",
                            "startedAt", "deadlineAt", "submittedAt", "rulesAcceptedAt", "maxScore")
     SELECT sample."examId" || '-a-' || split_part(e."candidateId", '-perf-user-', 2),
            sample."examId", e."candidateId", 1, 'SUBMITTED', 'NEEDS_REVIEW',
            sample."startedAt", sample."deadlineAt", sample."submittedAt", sample."rulesAcceptedAt", sample."maxScore"
     FROM "Attempt" sample JOIN "Enrollment" e ON e."examId" = sample."examId"
     WHERE sample.id = $1 AND e."candidateId" <> sample."userId"`,
    [exampleAttempt],
  );
  await sql(
    `INSERT INTO "AttemptQuestion" (id, "attemptId", "questionId", position, marks, snapshot, "optionOrder",
                                   "selectedOptionIds", "writtenAnswer", "autoScore", "manualScore")
     SELECT a.id || '-' || q.position, a.id, q."questionId", q.position, q.marks, q.snapshot, q."optionOrder",
            q."selectedOptionIds", q."writtenAnswer", q."autoScore",
            CASE WHEN q."autoScore" IS NULL AND q.position % 2 = 0 THEN q.marks END
     FROM "Attempt" a CROSS JOIN "AttemptQuestion" q
     WHERE a."examId" = $1 AND a.id <> $2 AND q."attemptId" = $2`,
    [exam.id, exampleAttempt],
  );
  await sql('ANALYZE "Attempt"');
  await sql('ANALYZE "AttemptQuestion"');
  examiner = await signInAs("examiner");
});

after(async () => {
  if (exam) {
    await removeEvaluationExam(exam);
    await sql('DELETE FROM "User" WHERE id LIKE ($1 || \'-perf-user-%\')', [exam.id]);
  }
  await resetRateLimits();
  await closeDatabase();
});

async function measure(label: string, path: string, budget: number, itemCount: number): Promise<void> {
  for (let warmUp = 0; warmUp < 5; warmUp++) await examiner.get(path);
  const times: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    const response = await examiner.get(path);
    times.push(performance.now() - started);
    assert.equal(response.status, 200, response.text.slice(0, 250));
    const items = Array.isArray(response.body.data) ? response.body.data : response.body.data.questions;
    assert.equal(items.length, itemCount);
  }
  times.sort((left, right) => left - right);
  const median = times[Math.floor(SAMPLES / 2)];
  const p95 = times[Math.floor(SAMPLES * 0.95)];
  console.log(`${label}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, budget ${budget} ms`);
  assert.ok(p95 <= budget, `${label}: p95 ${p95.toFixed(1)} ms exceeded the ${budget} ms budget`);
}

describe("grading reads with 500 attempts of 50 questions", () => {
  it("loads a page of pending written answers", () => measure("Grading queue", `/exams/${exam.id}/grading`, 60, 20));
  it("loads the full frozen submission", () => measure("Submission review", `/attempts/${exampleAttempt}/review`, 40, 50));
});
