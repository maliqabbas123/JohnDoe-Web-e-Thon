import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import { removeEvaluationExam, seedEvaluationExam } from "./evaluation-fixtures";
import { BASE_URL, Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "./helpers";

let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;

before(resetRateLimits);
after(async () => {
  if (exam) {
    await sql(`DELETE FROM "AuditLog" WHERE "entityId" = $1 OR "entityId" IN (
      SELECT r.id FROM "Report" r JOIN "Attempt" a ON a.id = r."attemptId" WHERE a."examId" = $1
    )`, [exam.id]);
    await removeEvaluationExam(exam);
  }
  await resetRateLimits();
  await closeDatabase();
});

it("starts, answers, submits, grades, releases and verifies a real candidate attempt", async () => {
  const [examiner, candidate, outsider] = await Promise.all([
    signInAs("examiner"), signInAs("candidate"), signInAs("candidate2"),
  ]);
  const [{ id: ownerId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  exam = await seedEvaluationExam(ownerId);
  const enrolled = await examiner.post(`/exams/${exam.id}/enrollments`, { emails: [TEST_ACCOUNTS.candidate.email] });
  assert.equal(enrolled.status, 200, enrolled.text);
  const started = await candidate.post(`/exams/${exam.id}/attempts`, { rulesAccepted: true });
  assert.equal(started.status, 201, started.text);
  const attempt = `/attempts/${started.body.data.id}`;
  assert.equal((await examiner.post(`${attempt}/report`)).status, 404);

  const answers = [
    { selectedOptionIds: [exam.questions[0].snapshot.options[0].id] },
    { writtenAnswer: "First written answer." },
    { writtenAnswer: "Second written answer." },
  ];
  for (const [index, answer] of answers.entries()) {
    const saved = await candidate.request("PUT", `${attempt}/answers/${index + 1}`, { json: { revision: 1, ...answer } });
    assert.equal(saved.status, 200, saved.text);
  }
  const submitted = await candidate.post(`${attempt}/submit`);
  assert.equal(submitted.status, 200, submitted.text);
  for (const position of [2, 3]) {
    const graded = await examiner.patch(`${attempt}/answers/${position}/grade`, { score: 1 });
    assert.equal(graded.status, 200, graded.text);
  }
  const released = await examiner.post(`/exams/${exam.id}/results/release`);
  assert.equal(released.status, 200, released.text);
  assert.equal(released.body.data.released, 1);
  assert.equal((await candidate.post(`${attempt}/report`)).status, 403);
  assert.equal((await candidate.get(`${attempt}/report.pdf`)).status, 404);

  const issued = await Promise.all([examiner.post(`${attempt}/report`), examiner.post(`${attempt}/report`)]);
  assert.deepEqual(issued.map(({ status }) => status).sort(), [200, 201], issued.map(({ text }) => text).join("\n"));
  const report = issued[0].body.data;
  assert.deepEqual(issued[1].body.data, report);
  const verificationPath = `/verify/${report.verificationCode}`;
  assert.ok(report.verificationUrl.endsWith(`/api/v1${verificationPath}`));
  assert.equal((await outsider.get(`${attempt}/report.pdf`)).status, 404);
  const download = async () => {
    const session = candidate.cookie("exam_session");
    assert.ok(session);
    const response = await fetch(`${BASE_URL}/api/v1${attempt}/report.pdf`, {
      headers: { Cookie: `exam_session=${session}` },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition") ?? "", /^attachment;/);
    return Buffer.from(await response.arrayBuffer());
  };
  const original = await download();
  assert.equal((await PDFDocument.load(original)).getTitle(), "Evaluation fixture");
  const [stored] = await sql<{ contentHash: string }>('SELECT "contentHash" FROM "Report" WHERE id = $1', [report.id]);
  assert.equal(stored.contentHash, createHash("sha256").update(original).digest("hex"));
  await sql('UPDATE "Exam" SET title = $2 WHERE id = $1', [exam.id, "Renamed after issue"]);
  assert.deepEqual(await download(), original);

  const unauthenticated = new Client();
  const verified = await unauthenticated.get(verificationPath);
  assert.equal(verified.status, 200, verified.text);
  assert.deepEqual(verified.body.data, { validity: "VALID", examTitle: "Evaluation fixture", score: 2.1, issuedAt: report.issuedAt });
  const changed = await examiner.patch(`${attempt}/answers/2/grade`, { score: 2, reason: "Corrected mark." });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await unauthenticated.get(verificationPath)).body.data.validity, "SUPERSEDED");
  assert.equal((await candidate.get(`${attempt}/report.pdf`)).status, 404);
  const replacement = await examiner.post(`${attempt}/report`);
  assert.equal(replacement.status, 201, replacement.text);
  assert.notEqual(replacement.body.data.verificationCode, report.verificationCode);
  await sql('UPDATE "Report" SET "revokedAt" = now() WHERE id = $1', [replacement.body.data.id]);
  const revoked = await unauthenticated.get(`/verify/${replacement.body.data.verificationCode}`);
  assert.equal(revoked.body.data.validity, "REVOKED");
});

it("rate-limits public verification by address", async () => {
  const client = new Client();
  const makeRequest = () => client.get("/verify/unknown-code", { headers: { "X-Forwarded-For": "192.0.2.51" } });
  for (let call = 0; call < 60; call++) assert.equal((await makeRequest()).status, 404);
  assert.equal((await makeRequest()).status, 429);
});
