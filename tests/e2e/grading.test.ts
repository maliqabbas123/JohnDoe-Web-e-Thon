import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "./evaluation-fixtures";
import {
  Client, TEST_ACCOUNTS, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, signInAs, sql,
} from "./helpers";

const queue = (examId: string) => `/exams/${examId}/grading`;
const review = (id: string) => `/attempts/${id}/review`;
const grade = (id: string, position: number | string = 2) => `/attempts/${id}/answers/${position}/grade`;

let examiner: Client;
let otherExaminer: Client;
let admin: Client;
let candidate: Client;
let examinerId: string;
let candidateId: string;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;

before(async () => {
  await resetRateLimits();
  examiner = await signInAs("examiner");
  admin = await signInAs("admin");
  candidate = await signInAs("candidate");
  otherExaminer = (await createTempUser("EXAMINER")).client;
  const [owner] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [user] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  examinerId = owner.id;
  candidateId = user.id;
});

beforeEach(async () => {
  await resetRateLimits();
  exam = await seedEvaluationExam(examinerId);
});

afterEach(async () => {
  if (exam) await removeEvaluationExam(exam);
});

after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

describe("examiner grading", () => {
  it("restricts all operations to the owning examiner", async () => {
    const attemptId = await seedEvaluationAttempt(exam, candidateId);
    for (const [client, status] of [
      [new Client(), 401], [admin, 403], [candidate, 403], [otherExaminer, 404],
    ] as const) {
      assert.equal((await client.get(queue(exam.id))).status, status);
      assert.equal((await client.get(review(attemptId))).status, status);
      assert.equal((await client.patch(grade(attemptId), { score: 1 })).status, status);
    }
    assert.equal((await examiner.get(queue("missing"))).status, 404);
    assert.equal((await examiner.get(review("missing"))).status, 404);
    assert.equal((await examiner.patch(grade(attemptId, 4), { score: 1 })).status, 404);
  });

  it("pages oldest first through pending written answers, including blank and expired responses", async () => {
    const olderTime = new Date(Date.now() - 120_000);
    const newerTime = new Date(Date.now() - 60_000);
    const newer = await seedEvaluationAttempt(exam, candidateId, { submittedAt: newerTime, attemptNumber: 2 });
    const older = await seedEvaluationAttempt(exam, candidateId, { status: "EXPIRED", submittedAt: olderTime });
    const sandbox = await seedEvaluationAttempt(exam, examinerId, { isSandbox: true, submittedAt: olderTime });
    const live = await seedEvaluationAttempt(exam, candidateId, { status: "IN_PROGRESS", attemptNumber: 3 });

    const first = await examiner.get(`${queue(exam.id)}?pageSize=1`);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(first.body.data[0]).sort(), ["attemptId", "candidate", "marks", "position", "submittedAt"]);
    assert.deepEqual(first.body.data[0], {
      attemptId: older, position: 2, submittedAt: olderTime.toISOString(), marks: 2.5,
      candidate: { id: candidateId, name: TEST_ACCOUNTS.candidate.name },
    });

    // Removing the cursor's answer from the queue must not skip the next item.
    assert.equal((await examiner.patch(grade(older), { score: 1 })).status, 200);
    const next = await examiner.get(`${queue(exam.id)}?cursor=${first.body.meta.nextCursor}`);
    assert.equal(next.status, 200, next.text);
    assert.deepEqual(next.body.data.map(({ attemptId, position }: { attemptId: string; position: number }) =>
      [attemptId, position]), [[older, 3], [newer, 2], [newer, 3]]);
    assert.deepEqual(next.body.meta, { pageSize: 20, nextCursor: null });

    for (const [id, status] of [[sandbox, 404], [live, 409]] as const) {
      assert.equal((await examiner.get(review(id))).status, status);
      assert.equal((await examiner.patch(grade(id), { score: 1 })).status, status);
    }
    for (const [id, position] of [[older, 3], [newer, 2], [newer, 3]] as const) {
      assert.equal((await examiner.patch(grade(id, position), { score: 0 })).status, 200);
    }
    assert.deepEqual((await examiner.get(queue(exam.id))).body, {
      data: [], meta: { pageSize: 20, nextCursor: null },
    });
  });

  it("returns the frozen paper and objective key in the served order", async () => {
    const id = await seedEvaluationAttempt(exam, candidateId, { status: "EXPIRED" });
    await sql('UPDATE "Question" SET text = $1 WHERE id = $2', ["Edited in bank", exam.questions[0].id]);
    await sql('UPDATE "Attempt" SET "honeypotMarker" = $1, scratchpad = $2 WHERE id = $3', ["hidden", "private", id]);
    const response = await examiner.get(review(id));
    assert.equal(response.status, 200, response.text);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const { data } = response.body;
    assert.deepEqual(Object.keys(data).sort(), [
      "attemptNumber", "candidate", "exam", "gradingStatus", "id", "maxScore", "questions",
      "resultReleasedAt", "score", "status", "submittedAt",
    ]);
    assert.deepEqual(data.candidate, { id: candidateId, name: TEST_ACCOUNTS.candidate.name });
    assert.equal(data.maxScore, 5.1);
    assert.equal(data.score, null);
    assert.equal(data.status, "EXPIRED");
    assert.equal(data.gradingStatus, "NEEDS_REVIEW");
    assert.deepEqual(data.questions[0], {
      position: 1, type: "SINGLE_CHOICE", difficulty: "MEDIUM", topic: exam.questions[0].snapshot.topic,
      text: "Frozen question 1", options: [...exam.questions[0].snapshot.options].reverse(),
      alsoAccepted: [], voided: false, marks: 0.1,
      selectedOptionIds: [exam.questions[0].snapshot.options[0].id], writtenAnswer: null,
      autoScore: 0.1, manualScore: null, score: 0.1, feedback: null, gradedAt: null,
    });
    assert.equal(data.questions[1].writtenAnswer, "Candidate's written answer");
    assert.equal(data.questions[2].writtenAnswer, null);
    assert.equal(data.questions[2].score, null);
  });

  it("validates grades and path, query and body bounds before applying changes", async () => {
    const id = await seedEvaluationAttempt(exam, candidateId);
    const path = grade(id);
    for (const body of [
      {}, { score: "1" }, { score: -0.01 }, { score: 2.51 }, { score: 1.005 }, { score: 100000 },
      { score: 1, feedback: "f".repeat(5001) }, { score: 1, reason: "r".repeat(1001) },
      { score: 1, reason: " " }, { score: 1, feedback: 5 }, { score: 1, gradedById: candidateId },
    ]) {
      const response = await examiner.patch(path, body);
      assert.equal(response.status, 422, response.text);
    }
    for (const position of [0, "-1", "01", "2.0", "2147483648"]) {
      assert.equal((await examiner.patch(grade(id, position), { score: 1 })).status, 422);
    }
    assert.equal((await examiner.patch(grade(id, 1), { score: 0.1 })).status, 422);
    assert.equal((await examiner.patch(grade("bad%2Fid"), { score: 1 })).status, 404);
    for (const query of ["pageSize=0", "pageSize=101", "pageSize=1.5", "cursor=invalid", "ownerId=another"]) {
      assert.equal((await examiner.get(`${queue(exam.id)}?${query}`)).status, 422, query);
    }
    assert.equal((await examiner.get(`${queue(exam.id)}?cursor=%00`)).status, 400);
    assert.equal((await examiner.patch(path, { score: 1, feedback: "NUL\u0000" })).status, 400);
    assert.equal((await examiner.patch(path, { score: 1, feedback: "f".repeat(65_536) })).status, 413);
    assert.equal((await examiner.patch(path, { score: 1 }, { headers: { Origin: "https://untrusted.example" } })).status, 403);

    const text = "Check <steps>; ' OR 1=1 --";
    const marked = await examiner.patch(path, { score: 2.5, feedback: text });
    assert.equal(marked.status, 200, marked.text);
    assert.equal(marked.body.data.answer.feedback, text);
    const zero = await examiner.patch(grade(id, 3), { score: 0 });
    assert.equal(zero.status, 200, zero.text);
    assert.deepEqual(zero.body.data.attempt, { id, gradingStatus: "GRADED", score: 2.6 });
  });

  it("sums grades exactly and keeps the total null until the final written answer is marked", async () => {
    const id = await seedEvaluationAttempt(exam, candidateId);
    const first = await examiner.patch(grade(id), { score: 0.2, feedback: "Keep showing your work." });
    assert.equal(first.status, 200, first.text);
    const { gradedAt } = first.body.data.answer;
    assert.deepEqual(first.body.data, {
      attempt: { id, gradingStatus: "NEEDS_REVIEW", score: null },
      answer: { position: 2, manualScore: 0.2, feedback: "Keep showing your work.", gradedAt },
    });
    assert.ok(Number.isFinite(Date.parse(gradedAt)));
    const replay = await examiner.patch(grade(id), { score: 0.2 });
    assert.deepEqual(replay.body, first.body);

    const final = await examiner.patch(grade(id, 3), { score: 0.3 });
    assert.equal(final.status, 200, final.text);
    assert.deepEqual(final.body.data.attempt, { id, gradingStatus: "GRADED", score: 0.6 });
    const [stored] = await sql(
      `SELECT a.score::float AS score, a."gradingStatus", q."manualScore"::float AS "manualScore", q."gradedById", q.feedback
       FROM "Attempt" a JOIN "AttemptQuestion" q ON q."attemptId" = a.id WHERE a.id = $1 AND q.position = 2`,
      [id],
    );
    assert.deepEqual(stored, {
      score: 0.6, gradingStatus: "GRADED", manualScore: 0.2, gradedById: examinerId, feedback: "Keep showing your work.",
    });
    const audits = await sql(
      `SELECT "actorId", metadata FROM "AuditLog" WHERE action = 'ANSWER_GRADED' AND "entityId" = $1`,
      [`${id}-answer-2`],
    );
    assert.deepEqual(audits, [{
      actorId: examinerId, metadata: { attemptId: id, position: 2, scoreChanged: true, released: false },
    }]);
  });

  it("serializes concurrent grades on different answers and concurrent revisions on one answer", async () => {
    const id = await seedEvaluationAttempt(exam, candidateId);
    const first = await Promise.all([
      examiner.patch(grade(id), { score: 0.2 }),
      examiner.patch(grade(id, 3), { score: 0.3 }),
    ]);
    for (const response of first) assert.equal(response.status, 200, response.text);
    assert.deepEqual(first.map(({ body }) => body.data.attempt.gradingStatus).sort(), ["GRADED", "NEEDS_REVIEW"]);

    const revisions = await Promise.all([
      examiner.patch(grade(id), { score: 0.4 }),
      examiner.patch(grade(id), { score: 0.5 }),
    ]);
    for (const response of revisions) assert.equal(response.status, 200, response.text);
    const checked = await examiner.get(review(id));
    assert.equal(checked.status, 200, checked.text);
    const final = checked.body.data.questions[1].manualScore;
    assert.ok(final === 0.4 || final === 0.5);
    assert.equal(checked.body.data.score, final === 0.4 ? 0.8 : 0.9);

    const changes = await sql<{ previous: number; next: number }>(
      `SELECT "previousScore"::float AS previous, "newScore"::float AS next
       FROM "GradeChange" WHERE "attemptQuestionId" = $1`,
      [`${id}-answer-2`],
    );
    const initialChange = changes.find(({ previous }) => previous === 0.2);
    assert.equal(changes.length, 2);
    assert.ok(initialChange);
    assert.deepEqual(changes.find(({ next }) => next === final), { previous: initialChange.next, next: final });
  });

  it("requires a reason for a released score change and supersedes the previous report exactly once", async () => {
    const id = await seedEvaluationAttempt(exam, candidateId);
    assert.equal((await examiner.patch(grade(id), { score: 1, feedback: "Initial feedback" })).status, 200);
    assert.equal((await examiner.patch(grade(id, 3), { score: 1 })).status, 200);
    await sql('UPDATE "Attempt" SET "resultReleasedAt" = now() WHERE id = $1', [id]);
    await sql(
      `INSERT INTO "Report" (id, "attemptId", "verificationCode", score, "maxScore", "contentHash", "issuedById")
       VALUES ($1, $2, $1, 2.1, 5.1, 'fixture-hash', $3)`,
      [`${id}-report`, id, examinerId],
    );

    const refused = await examiner.patch(grade(id), { score: 1.5, feedback: "Do not apply this." });
    assert.equal(refused.status, 422, refused.text);
    assert.equal(refused.body.error.details[0].path, "reason");
    const unchanged = await examiner.patch(grade(id), { score: 1, feedback: null });
    assert.equal(unchanged.status, 200, unchanged.text);
    assert.equal(unchanged.body.data.answer.feedback, null);
    assert.deepEqual(await sql('SELECT "supersededAt" FROM "Report" WHERE "attemptId" = $1', [id]), [{ supersededAt: null }]);

    const reason = "The original mark omitted a correct step.";
    const corrected = await examiner.patch(grade(id), { score: 1.5, reason });
    assert.equal(corrected.status, 200, corrected.text);
    assert.equal(corrected.body.data.attempt.score, 2.6);
    assert.deepEqual((await examiner.patch(grade(id), { score: 1.5 })).body, corrected.body);
    const changes = await sql(
      `SELECT "previousScore"::float AS "previousScore", "newScore"::float AS "newScore", reason, "changedById"
       FROM "GradeChange" WHERE "attemptQuestionId" = $1`,
      [`${id}-answer-2`],
    );
    assert.deepEqual(changes, [{ previousScore: 1, newScore: 1.5, reason, changedById: examinerId }]);
    assert.deepEqual(
      await sql('SELECT "supersededAt" FROM "Report" WHERE "attemptId" = $1', [id]),
      [{ supersededAt: new Date(corrected.body.data.answer.gradedAt) }],
    );
  });
});
