import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "./evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "./helpers";

let examiner: Client;
let candidate: Client;
let other: Client;
let admin: Client;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let ownerId: string;
let candidateId: string;
let otherId: string;

const request = (id: string) => `/attempts/${id}/disputes`;
const detail = (id: string) => `/disputes/${id}`;
const decide = (id: string, itemId: string) => `${detail(id)}/items/${itemId}`;

async function released(id: string) {
  for (const position of [2, 3]) {
    const grade = await examiner.patch(`/attempts/${id}/answers/${position}/grade`, { score: 1 });
    assert.equal(grade.status, 200, grade.text);
  }
  const release = await examiner.post(`/exams/${exam.id}/results/release`);
  assert.equal(release.status, 200, release.text);
}

before(async () => {
  await resetRateLimits();
  [examiner, candidate, other, admin] = await Promise.all([
    signInAs("examiner"), signInAs("candidate"), signInAs("candidate2"), signInAs("admin"),
  ]);
  for (const account of ["examiner", "candidate", "candidate2"] as const) {
    const [user] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS[account].email]);
    if (account === "examiner") ownerId = user.id;
    else if (account === "candidate") candidateId = user.id;
    else otherId = user.id;
  }
});

beforeEach(async () => {
  await resetRateLimits();
  exam = await seedEvaluationExam(ownerId);
});

afterEach(async () => {
  if (!exam) return;
  await sql(`DELETE FROM "AuditLog" WHERE "entityId" = $1 OR "entityId" IN (
    SELECT d.id FROM "Dispute" d JOIN "Attempt" a ON a.id = d."attemptId" WHERE a."examId" = $1
  )`, [exam.id]);
  await removeEvaluationExam(exam);
});

after(async () => {
  await resetRateLimits();
  await closeDatabase();
});

describe("candidate disputes", () => {
  it("checks ownership, release and the deadline, and downloads valid evidence only to its participants", async () => {
    const attempt = await seedEvaluationAttempt(exam, candidateId);
    const body = { category: "GRADING_ERROR", positions: [2], explanation: "The second step deserves a mark." };
    assert.equal((await candidate.post(request(attempt), body)).status, 404);
    await released(attempt);
    assert.equal((await other.post(request(attempt), body)).status, 404);
    assert.equal((await admin.post(request(attempt), body)).status, 403);
    assert.equal((await candidate.post(request(attempt), { ...body, positions: [2, 2] })).status, 422);
    assert.equal((await candidate.post(request(attempt), {
      ...body, attachment: { fileName: "fake.pdf", contentBase64: Buffer.from("plain text").toString("base64") },
    })).status, 422);
    const oversized = Buffer.alloc(4 * 1024 * 1024 + 1, 0);
    oversized.write("%PDF-");
    assert.equal((await candidate.post(request(attempt), {
      ...body, attachment: { fileName: "large.pdf", contentBase64: oversized.toString("base64") },
    })).status, 413);

    const evidence = Buffer.from("%PDF-1.4\nEvidence fixture\n");
    const filed = await candidate.post(request(attempt), {
      ...body, attachment: { fileName: "../proof.bin", contentBase64: evidence.toString("base64") },
    });
    assert.equal(filed.status, 201, filed.text);
    const { id, attachment } = filed.body.data;
    assert.deepEqual(attachment, { fileName: "proof.pdf", mimeType: "application/pdf", sizeBytes: evidence.length });
    assert.equal((await candidate.post(request(attempt), body)).status, 409);
    assert.equal((await other.get(`${detail(id)}/attachment`)).status, 404);
    assert.equal((await admin.get(`${detail(id)}/attachment`)).status, 403);
    for (const client of [candidate, examiner]) {
      const download = await client.get(`${detail(id)}/attachment`);
      assert.equal(download.status, 200, download.text);
      assert.equal(download.headers.get("content-disposition"), 'attachment; filename="proof.pdf"');
      assert.equal(download.headers.get("x-content-type-options"), "nosniff");
      assert.equal(download.text, evidence.toString());
    }
    assert.equal((await candidate.get("/me/disputes?status=OPEN")).body.data[0].id, id);
    assert.equal((await examiner.get(`/exams/${exam.id}/disputes`)).body.data[0].id, id);
    assert.equal((await examiner.get(detail(id))).status, 200);
    assert.deepEqual((await other.get("/me/disputes")).body.data, []);
    await sql(`UPDATE "Attempt" SET "resultReleasedAt" = now() - interval '73 hours' WHERE id = $1`, [attempt]);
    assert.equal((await candidate.post(request(attempt), { ...body, positions: [3] })).status, 409);
  });

  it("records grade corrections, supersedes reports and resolves a dispute after all items are decided", async () => {
    const attempt = await seedEvaluationAttempt(exam, candidateId);
    await released(attempt);
    await sql(
      `INSERT INTO "Report" (id, "attemptId", "verificationCode", score, "maxScore", "contentHash", "issuedById")
       VALUES ($1, $2, $1, 2.1, 5.1, 'fixture', $3)`, [`${attempt}-report`, attempt, ownerId],
    );
    const filed = await candidate.post(request(attempt), { category: "GRADING_ERROR", positions: [2, 3], explanation: "Check both answers." });
    assert.equal(filed.status, 201, filed.text);
    const { id, items } = filed.body.data;
    const item = items.find((entry: { position: number }) => entry.position === 2);
    const path = decide(id, item.id);
    const correction = { action: "REGRADE", reason: "The method was correct.", score: 2 };
    assert.equal((await candidate.patch(path, correction)).status, 403);
    assert.equal((await examiner.patch(path, { ...correction, score: 3 })).status, 422);
    const changed = await examiner.patch(path, correction);
    assert.equal(changed.status, 200, changed.text);
    assert.equal(changed.body.data.status, "OPEN");
    assert.equal((await examiner.patch(path, correction)).status, 409);
    const second = items.find((entry: { position: number }) => entry.position === 3);
    const closed = await examiner.patch(decide(id, second.id), { action: "REJECT", reason: "The original score stands." });
    assert.equal(closed.status, 200, closed.text);
    assert.equal(closed.body.data.status, "RESOLVED");
    const [result] = await sql<{ score: number; supersededAt: Date }>(
      `SELECT a.score::float8 AS score, r."supersededAt" FROM "Attempt" a JOIN "Report" r ON r."attemptId" = a.id WHERE a.id = $1`, [attempt],
    );
    assert.equal(result.score, 3.1);
    assert.ok(result.supersededAt instanceof Date);
    assert.deepEqual(await sql(`SELECT "previousScore"::float8 AS before, "newScore"::float8 AS after
      FROM "GradeChange" WHERE "disputeItemId" = $1`, [item.id]), [{ before: 1, after: 2 }]);
  });

  it("applies an accepted answer across the exam without lowering the original correct grade", async () => {
    const claimant = await seedEvaluationAttempt(exam, candidateId);
    const original = await seedEvaluationAttempt(exam, otherId);
    const alternate = exam.questions[0].snapshot.options[1].id;
    await sql('UPDATE "AttemptQuestion" SET "autoScore" = 0, "selectedOptionIds" = $2 WHERE "attemptId" = $1 AND position = 1', [claimant, [alternate]]);
    await released(claimant);
    await released(original);
    const filed = await candidate.post(request(claimant), {
      category: "FAULTY_QUESTION", positions: [1], explanation: "Both published choices satisfy the question.",
    });
    assert.equal(filed.status, 201, filed.text);
    const { id, items: [item] } = filed.body.data;
    const accepted = await examiner.patch(decide(id, item.id), {
      action: "ACCEPT_ALTERNATIVE", optionIds: [alternate], reason: "Accept both options.",
    });
    assert.equal(accepted.status, 200, accepted.text);
    assert.equal(accepted.body.data.status, "RESOLVED");
    for (const attempt of [claimant, original]) {
      const [row] = await sql<{ score: number; accepted: string[][] }>(`SELECT a.score::float8 AS score, q.snapshot->'alsoAccepted' AS accepted
        FROM "Attempt" a JOIN "AttemptQuestion" q ON q."attemptId" = a.id WHERE a.id = $1 AND q.position = 1`, [attempt]);
      assert.deepEqual(row, { score: 2.1, accepted: [[alternate]] });
    }
    assert.deepEqual(await sql(`SELECT "previousScore"::float8 AS before, "newScore"::float8 AS after
      FROM "GradeChange" WHERE "disputeItemId" = $1`, [item.id]), [{ before: 0, after: 0.1 }]);
  });

  it("resolves technical disputes with a retake for the candidate who filed", async () => {
    const attempt = await seedEvaluationAttempt(exam, candidateId);
    await released(attempt);
    const filed = await candidate.post(request(attempt), { category: "TECHNICAL_INCIDENT", explanation: "Network interruption." });
    assert.equal(filed.status, 201, filed.text);
    const { id, items: [item] } = filed.body.data;
    assert.equal(item.position, null);
    const result = await examiner.patch(decide(id, item.id), {
      action: "GRANT_RETAKE", reason: "The loss of contact was documented.",
      startsAt: new Date(Date.now() + 60_000).toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.data.status, "RESOLVED");
    assert.equal(result.body.data.retakeGrant.attemptsAllowed, 1);
    assert.deepEqual(await sql('SELECT "candidateId" FROM "RetakeGrant" WHERE "disputeId" = $1', [id]), [{ candidateId }]);
  });
});
