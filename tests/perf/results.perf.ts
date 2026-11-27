import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "../e2e/evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const ATTEMPTS = 2_000;
const QUESTIONS = 50;
const HISTORY = 30;
const SAMPLES = 20;

let examiner: Client;
let candidate: Client;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let sampleAttempt: string;

before(async () => {
  await resetRateLimits();
  const [{ id: ownerId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [{ id: candidateId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  exam = await seedEvaluationExam(ownerId, QUESTIONS);
  sampleAttempt = await seedEvaluationAttempt(exam, candidateId);

  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT $1 || '-u-' || n, $1 || '-u-' || n || '@exam.test', 'Candidate ' || n, 'fixture', 'CANDIDATE', now()
     FROM generate_series(1, $2::int) n`, [exam.id, ATTEMPTS - 1],
  );
  await sql(
    `INSERT INTO "Enrollment" (id, "examId", "candidateId", "enrolledById")
     SELECT u.id || '-enr', $1, u.id, $2 FROM "User" u WHERE u.id LIKE ($1 || '-u-%')`, [exam.id, ownerId],
  );
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", status, "gradingStatus",
                            "startedAt", "deadlineAt", "submittedAt", "rulesAcceptedAt", "maxScore")
     SELECT e."candidateId" || '-a', sample."examId", e."candidateId", 1, 'SUBMITTED', 'GRADED',
            sample."startedAt", sample."deadlineAt", sample."submittedAt", sample."rulesAcceptedAt", sample."maxScore"
     FROM "Attempt" sample JOIN "Enrollment" e ON e."examId" = sample."examId"
     WHERE sample.id = $1 AND e."candidateId" <> sample."userId"`, [sampleAttempt],
  );
  await sql(
    `INSERT INTO "AttemptQuestion" (id, "attemptId", "questionId", position, marks, snapshot, "optionOrder",
                                   "selectedOptionIds", "writtenAnswer", "autoScore", "manualScore", "timeSpentSeconds")
     SELECT a.id || '-q' || q.position, a.id, q."questionId", q.position, q.marks, q.snapshot, q."optionOrder",
            CASE WHEN q."autoScore" IS NOT NULL AND choices.wrong THEN ARRAY[q."optionOrder"[1]] ELSE q."selectedOptionIds" END,
            q."writtenAnswer", CASE WHEN choices.wrong AND q."autoScore" IS NOT NULL THEN 0 ELSE q."autoScore" END,
            CASE WHEN q."autoScore" IS NULL THEN CASE WHEN q."writtenAnswer" IS NULL THEN 0 ELSE q.marks / 2 END END,
            10 + q.position
     FROM "Attempt" a CROSS JOIN "AttemptQuestion" q
     CROSS JOIN LATERAL (SELECT mod(abs(hashtext(a.id)::bigint) + q.position, 4) = 0 AS wrong) choices
     WHERE a."examId" = $1 AND a.id <> $2 AND q."attemptId" = $2`, [exam.id, sampleAttempt],
  );
  await sql(
    `UPDATE "AttemptQuestion" SET "manualScore" = CASE WHEN "writtenAnswer" IS NULL THEN 0 ELSE marks / 2 END
     WHERE "attemptId" = $1 AND "autoScore" IS NULL`, [sampleAttempt],
  );
  await sql(
    `UPDATE "Attempt" a SET score = totals.score, "gradingStatus" = 'GRADED', "resultReleasedAt" = now()
     FROM (SELECT q."attemptId", sum(coalesce(q."manualScore", q."autoScore")) AS score
           FROM "AttemptQuestion" q JOIN "Attempt" a ON a.id = q."attemptId"
           WHERE a."examId" = $1 GROUP BY q."attemptId") totals
     WHERE a.id = totals."attemptId"`, [exam.id],
  );
  // Give the signed-in candidate a history large enough to exercise paging.
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, status, "startsAt", "endsAt", "durationMinutes", "totalMarks", "updatedAt")
     SELECT e.id || '-hist-' || n, e."ownerId", 'Past exam ' || n, 'COMPLETED', e."startsAt", e."endsAt",
            e."durationMinutes", e."totalMarks", now()
     FROM "Exam" e CROSS JOIN generate_series(1, $2::int) n WHERE e.id = $1`, [exam.id, HISTORY],
  );
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", status, "gradingStatus", "deadlineAt",
                            "submittedAt", "rulesAcceptedAt", score, "maxScore", "resultReleasedAt")
     SELECT e.id || '-a', e.id, a."userId", 1, 'SUBMITTED', 'GRADED', a."deadlineAt", a."submittedAt",
            a."rulesAcceptedAt", a.score, a."maxScore", a."resultReleasedAt" - interval '1 day'
     FROM "Exam" e CROSS JOIN "Attempt" a WHERE e.id LIKE ($1 || '-hist-%') AND a.id = $2`, [exam.id, sampleAttempt],
  );
  for (const table of ["Exam", "Attempt", "AttemptQuestion", "Enrollment", "User"]) await sql(`ANALYZE "${table}"`);
  examiner = await signInAs("examiner");
  candidate = await signInAs("candidate");
});

after(async () => {
  if (exam) {
    await sql('DELETE FROM "Attempt" WHERE "examId" LIKE ($1 || \'-hist-%\')', [exam.id]);
    await sql('DELETE FROM "Exam" WHERE id LIKE ($1 || \'-hist-%\')', [exam.id]);
    await removeEvaluationExam(exam);
    await sql('DELETE FROM "User" WHERE id LIKE ($1 || \'-u-%\')', [exam.id]);
  }
  await resetRateLimits();
  await closeDatabase();
});

async function measure(client: Client, path: string, budget: number, check: (body: unknown) => void) {
  for (let run = 0; run < 3; run++) await client.get(path);
  const times: number[] = [];
  for (let run = 0; run < SAMPLES; run++) {
    const start = performance.now();
    const response = await client.get(path);
    times.push(performance.now() - start);
    assert.equal(response.status, 200, response.text.slice(0, 250));
    check(response.body.data);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(times.length * 0.95) - 1];
  console.log(`${path}: p95 ${p95.toFixed(1)} ms (budget ${budget} ms)`);
  assert.ok(p95 <= budget, `${path} exceeded its budget`);
}

function pageHas(expected: number) {
  return (body: unknown) => {
    assert.ok(Array.isArray(body));
    assert.equal(body.length, expected);
  };
}

describe("results reads with 2,000 attempts of 50 questions", () => {
  it("examiner result list", () => measure(examiner, `/exams/${exam.id}/results`, 100, pageHas(20)));
  it("candidate result history", () => measure(candidate, "/me/results", 75, pageHas(20)));
  it("candidate review", () => measure(candidate, `/me/results/${sampleAttempt}`, 100, (body) =>
    pageHas(QUESTIONS)((body as { questions: unknown }).questions)));
  it("exam score and fairness analytics", () => measure(examiner, `/exams/${exam.id}/analytics`, 750, (body) => {
    const stats = body as { scores: { count: number }; fairness: { comparablePapers: number; papers: unknown } };
    assert.equal(stats.scores.count, ATTEMPTS);
    assert.equal(stats.fairness.comparablePapers, ATTEMPTS);
    pageHas(20)(stats.fairness.papers);
  }));
  it("question analytics for a whole paper", () =>
    measure(examiner, `/exams/${exam.id}/analytics/questions?pageSize=50`, 1_250, pageHas(QUESTIONS)));
});
