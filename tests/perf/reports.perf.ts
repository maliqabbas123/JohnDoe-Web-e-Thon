import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "../e2e/evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let candidate: Client;
let reportId: string;
let attemptId: string;
let code: string;

before(async () => {
  await resetRateLimits();
  const [owner] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [user] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  exam = await seedEvaluationExam(owner.id, 1);
  attemptId = await seedEvaluationAttempt(exam, user.id);
  const examiner = await signInAs("examiner");
  candidate = await signInAs("candidate");
  assert.equal((await examiner.post(`/exams/${exam.id}/results/release`)).status, 200);
  const issued = await examiner.post(`/attempts/${attemptId}/report`);
  assert.equal(issued.status, 201, issued.text);
  reportId = issued.body.data.id;
  code = issued.body.data.verificationCode;
  await sql(
    `INSERT INTO "Report" (id, "attemptId", "verificationCode", score, "maxScore", "contentHash", "issuedById", "supersededAt")
     SELECT r.id || '-prior-' || n, r."attemptId", r."verificationCode" || '-prior-' || n,
            r.score, r."maxScore", r."contentHash", r."issuedById", now()
     FROM "Report" r CROSS JOIN generate_series(1, 999) n WHERE r.id = $1`, [reportId],
  );
});

after(async () => {
  if (exam) {
    await sql('DELETE FROM "AuditLog" WHERE "entityId" IN ($1, $2)', [exam.id, reportId]);
    await removeEvaluationExam(exam);
  }
  await resetRateLimits();
  await closeDatabase();
});

async function measure(client: Client, path: string) {
  for (let n = 0; n < 3; n++) await client.get(path);
  const times: number[] = [];
  for (let n = 0; n < 15; n++) {
    const start = performance.now();
    const response = await client.get(path);
    times.push(performance.now() - start);
    assert.equal(response.status, 200, response.text.slice(0, 200));
  }
  const p95 = Math.max(...times);
  console.log(`${path}: p95 ${p95.toFixed(1)} ms (budget 100 ms)`);
  assert.ok(p95 <= 100, `${path} exceeded 100 ms`);
}

it("downloads the active PDF among 1,000 report versions", () => measure(candidate, `/attempts/${attemptId}/report.pdf`));
it("verifies a code among 1,000 report versions", () => measure(new Client(), `/verify/${code}`));
