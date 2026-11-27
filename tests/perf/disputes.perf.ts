import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { removeEvaluationExam, seedEvaluationExam } from "../e2e/evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

let candidate: Client;
let examiner: Client;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let disputeId: string;

before(async () => {
  await resetRateLimits();
  const [owner] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [author] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  exam = await seedEvaluationExam(owner.id, 1);
  disputeId = `${exam.id}-d-1`;
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", status, "gradingStatus",
      "deadlineAt", "submittedAt", "rulesAcceptedAt", score, "maxScore", "resultReleasedAt")
     SELECT $1 || '-a-' || n, $1, $2, n, 'SUBMITTED', 'GRADED',
       now(), now(), now(), 0.1, 0.1, now() FROM generate_series(1, 500) n`, [exam.id, author.id],
  );
  await sql(
    `INSERT INTO "Dispute" (id, "attemptId", "raisedById", category, explanation)
     SELECT $1 || '-d-' || n, $1 || '-a-' || n, $2, 'TECHNICAL_INCIDENT', 'Fixture evidence'
     FROM generate_series(1, 500) n`, [exam.id, author.id],
  );
  await sql(
    `INSERT INTO "DisputeItem" (id, "disputeId")
     SELECT id || '-item', id FROM "Dispute" WHERE id LIKE ($1 || '-d-%')`, [exam.id],
  );
  await sql(
    `INSERT INTO "DisputeAttachment" (id, "disputeId", "fileName", "mimeType", "sizeBytes", sha256, data)
     VALUES ($1 || '-file', $1, 'evidence.pdf', 'application/pdf', $2, 'fixture', $3)`,
    [disputeId, 32 * 1024, Buffer.from("%PDF-" + "X".repeat(32 * 1024 - 5))],
  );
  [examiner, candidate] = await Promise.all([signInAs("examiner"), signInAs("candidate")]);
});

after(async () => {
  if (exam) await removeEvaluationExam(exam);
  await resetRateLimits();
  await closeDatabase();
});

async function measure(client: Client, path: string, check: (body: unknown) => void) {
  for (let n = 0; n < 3; n++) await client.get(path);
  const times: number[] = [];
  for (let n = 0; n < 15; n++) {
    const start = performance.now();
    const response = await client.get(path);
    times.push(performance.now() - start);
    assert.equal(response.status, 200, response.text.slice(0, 150));
    check(response.body);
  }
  const p95 = Math.max(...times);
  console.log(`${path}: p95 ${p95.toFixed(1)} ms (budget 100 ms)`);
  assert.ok(p95 <= 100, `${path} exceeded 100 ms`);
}

function checkPage(body: unknown) {
  assert.equal((body as { data: unknown[] }).data.length, 20);
}

describe("dispute reads with 500 submissions", () => {
  it("candidate history", () => measure(candidate, "/me/disputes", checkPage));
  it("exam queue", () => measure(examiner, `/exams/${exam.id}/disputes`, checkPage));
  it("dispute detail", () => measure(examiner, `/disputes/${disputeId}`, (body) =>
    assert.equal((body as { data: { id: string } }).data.id, disputeId)));
  it("evidence download", () => measure(candidate, `/disputes/${disputeId}/attachment`, (body) => assert.equal(body, null)));
});
