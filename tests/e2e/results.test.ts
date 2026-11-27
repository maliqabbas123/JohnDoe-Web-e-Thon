import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "./evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, signInAs, sql } from "./helpers";

const examResults = (id: string) => `/exams/${id}/results`;
const release = (id: string) => `${examResults(id)}/release`;
const analytics = (id: string) => `/exams/${id}/analytics`;
const myResults = "/me/results";

let examiner: Client;
let otherExaminer: Client;
let candidate: Client;
let admin: Client;
let ownerId: string;
let candidateId: string;
let secondId: string;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
const fixtures: (typeof exam)[] = [];

async function fixture(questionCount?: number) {
  const created = await seedEvaluationExam(ownerId, questionCount);
  fixtures.push(created);
  return created;
}

async function mark(id: string, position: number, score: number) {
  const response = await examiner.patch(`/attempts/${id}/answers/${position}/grade`, { score });
  assert.equal(response.status, 200, response.text);
}

async function grade(id: string, first: number, second: number) {
  await mark(id, 2, first);
  await mark(id, 3, second);
}

async function releaseAll() {
  const response = await examiner.post(release(exam.id));
  assert.equal(response.status, 200, response.text);
  return response.body.data;
}

before(async () => {
  await resetRateLimits();
  examiner = await signInAs("examiner");
  candidate = await signInAs("candidate");
  admin = await signInAs("admin");
  otherExaminer = (await createTempUser("EXAMINER")).client;
  const ids = await sql<{ id: string; email: string }>('SELECT id, email FROM "User" WHERE email = ANY($1)', [
    [TEST_ACCOUNTS.examiner.email, TEST_ACCOUNTS.candidate.email, TEST_ACCOUNTS.candidate2.email],
  ]);
  ownerId = ids.find(({ email }) => email === TEST_ACCOUNTS.examiner.email)!.id;
  candidateId = ids.find(({ email }) => email === TEST_ACCOUNTS.candidate.email)!.id;
  secondId = ids.find(({ email }) => email === TEST_ACCOUNTS.candidate2.email)!.id;
});

beforeEach(async () => {
  await resetRateLimits();
  exam = await fixture();
});

afterEach(async () => {
  for (const item of fixtures.splice(0)) {
    await sql('DELETE FROM "AuditLog" WHERE action = $1 AND "entityId" = $2', ["RESULT_RELEASED", item.id]);
    await removeEvaluationExam(item);
  }
});

after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

describe("results and analytics", () => {
  it("enforces the examiner owner and candidate role across the endpoints", async () => {
    const id = await seedEvaluationAttempt(exam, candidateId);
    for (const [client, expected] of [[new Client(), 401], [candidate, 403], [admin, 403], [otherExaminer, 404]] as const) {
      for (const path of [examResults(exam.id), analytics(exam.id), `${analytics(exam.id)}/questions`]) {
        assert.equal((await client.get(path)).status, expected, path);
      }
      assert.equal((await client.post(release(exam.id))).status, expected);
    }
    for (const [client, expected] of [[new Client(), 401], [examiner, 403], [admin, 403]] as const) {
      assert.equal((await client.get(myResults)).status, expected);
      assert.equal((await client.get(`${myResults}/${id}`)).status, expected);
    }
    assert.equal((await examiner.get(examResults("missing"))).status, 404);
    assert.equal((await examiner.post(release("bad%2Fid"))).status, 404);
    const foreignOrigin = await examiner.post(release(exam.id), undefined, { headers: { Origin: "https://other.example" } });
    assert.equal(foreignOrigin.status, 403);
  });

  it("lists eligible results and pending submissions, with cursor paging", async () => {
    const early = await seedEvaluationAttempt(exam, candidateId);
    const late = await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 2, status: "EXPIRED" });
    const pending = await seedEvaluationAttempt(exam, secondId);
    await grade(early, 1, 1);
    await grade(late, 1, 1);

    const first = await examiner.get(`${examResults(exam.id)}?pageSize=1`);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.headers.get("cache-control"), "no-store");
    const next = await examiner.get(`${examResults(exam.id)}?cursor=${first.body.meta.nextCursor}`);
    assert.equal(next.status, 200, next.text);
    assert.equal(next.body.meta.nextCursor, null);
    const rows = [...first.body.data, ...next.body.data];
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(({ candidate, result }) => [candidate.id, result.attemptId, result.gradingStatus, result.score, result.resultReleasedAt])
      .sort((a, b) => a[0].localeCompare(b[0])), [
      [candidateId, early, "GRADED", 2.1, null], [secondId, pending, "NEEDS_REVIEW", null, null],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

    await sql('UPDATE "Exam" SET "resultPolicy" = $2 WHERE id = $1', [exam.id, "LATEST"]);
    const latest = await examiner.get(examResults(exam.id));
    assert.equal(latest.body.data.find((row: { candidate: { id: string } }) => row.candidate.id === candidateId).result.attemptId, late);
  });

  it("lists enrolled candidates without a submission and rejects invalid list inputs", async () => {
    await seedEvaluationAttempt(exam, candidateId, { status: "IN_PROGRESS" });
    const response = await examiner.get(examResults(exam.id));
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.data, [{ candidate: { id: candidateId, name: TEST_ACCOUNTS.candidate.name }, result: null }]);
    assert.deepEqual(await releaseAll(), { released: 0, alreadyReleased: 0, needsReview: 0, releasedAt: null });

    for (const path of [examResults(exam.id), analytics(exam.id), `${analytics(exam.id)}/questions`, myResults]) {
      const client = path === myResults ? candidate : examiner;
      for (const query of ["pageSize=0", "pageSize=101", "pageSize=1.5", "userId=invalid", "cursor=%27"]) {
        assert.equal((await client.get(`${path}?${query}`)).status, 422, query);
      }
      assert.equal((await client.get(`${path}?cursor=%00`)).status, 400);
    }
    assert.equal((await candidate.get(`${myResults}?cursor=bad`)).status, 422);
  });

  it("publishes only policy winners, counts skipped attempts and audits concurrent release once", async () => {
    const winning = await seedEvaluationAttempt(exam, candidateId);
    const losing = await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 2 });
    const tied = await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 3 });
    await seedEvaluationAttempt(exam, secondId);
    const expired = await seedEvaluationAttempt(exam, secondId, { attemptNumber: 2, status: "EXPIRED" });
    const sandbox = await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 4, isSandbox: true });
    await grade(winning, 2, 2);
    await grade(losing, 1, 1);
    await grade(tied, 2, 2);
    await grade(expired, 1.5, 2);
    await sql('UPDATE "Attempt" SET score = 5.1, "gradingStatus" = \'GRADED\' WHERE id = $1', [sandbox]);

    const responses = await Promise.all([releaseAll(), releaseAll()]);
    const [repeat, first] = responses.sort((a, b) => a.released - b.released);
    assert.deepEqual(repeat, { released: 0, alreadyReleased: 2, needsReview: 1, releasedAt: null });
    assert.deepEqual(first, { released: 2, alreadyReleased: 0, needsReview: 1, releasedAt: first.releasedAt });
    assert.ok(Number.isFinite(Date.parse(first.releasedAt)));
    assert.deepEqual(await sql(
      'SELECT id FROM "Attempt" WHERE "examId" = $1 AND "resultReleasedAt" IS NOT NULL ORDER BY id',
      [exam.id],
    ), [winning, expired].sort().map((id) => ({ id })));
    const [published] = await sql<{ resultsPublishedAt: Date }>('SELECT "resultsPublishedAt" FROM "Exam" WHERE id = $1', [exam.id]);
    assert.equal(published.resultsPublishedAt.toISOString(), first.releasedAt);
    assert.deepEqual(await sql('SELECT "actorId", metadata FROM "AuditLog" WHERE action = $1 AND "entityId" = $2',
      ["RESULT_RELEASED", exam.id]), [{ actorId: ownerId, metadata: { released: 2, alreadyReleased: 0, needsReview: 1 } }]);
  });

  it("keeps prior releases accessible during a private retake and protects frozen answer keys", async () => {
    const first = await seedEvaluationAttempt(exam, candidateId);
    const ownSandbox = await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 2, isSandbox: true });
    const other = await seedEvaluationAttempt(exam, secondId);
    await grade(first, 1, 1);
    await grade(other, 2, 2);
    assert.equal((await candidate.get(`${myResults}/${first}`)).status, 404);
    await releaseAll();
    const retake = await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 3 });
    await grade(retake, 2, 2);
    await sql(`UPDATE "Attempt" SET score = 5.1, "gradingStatus" = 'GRADED', "resultReleasedAt" = now() WHERE id = $1`, [ownSandbox]);

    let response = await candidate.get(myResults);
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.data.map((row: { attemptId: string }) => row.attemptId), [first]);
    for (const hidden of [ownSandbox, other, retake]) {
      assert.equal((await candidate.get(`${myResults}/${hidden}`)).status, 404);
    }
    let detail = await candidate.get(`${myResults}/${first}`);
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.headers.get("cache-control"), "no-store");
    assert.equal(detail.body.data.revealAnswers, false);
    assert.equal(detail.body.data.questions[0].answerKey, undefined);
    assert.doesNotMatch(detail.text, /isCorrect|honeypotMarker|gradedById|passwordHash/);

    const original = exam.questions[0].snapshot.options;
    await sql('UPDATE "Question" SET text = $2 WHERE id = $1', [exam.questions[0].id, "Edited question"]);
    await sql('UPDATE "Exam" SET "revealAnswers" = true WHERE id = $1', [exam.id]);
    detail = await candidate.get(`${myResults}/${first}`);
    const [objective, written] = detail.body.data.questions;
    assert.equal(objective.text, exam.questions[0].snapshot.text);
    assert.deepEqual(objective.options, [...original].reverse().map(({ id, text }) => ({ id, text })));
    assert.deepEqual(objective.answerKey, { correctOptionIds: [original[0].id], alsoAccepted: [], voided: false });
    assert.equal(written.answerKey, undefined);
    assert.equal(written.score, 1);

    await releaseAll();
    response = await candidate.get(myResults);
    assert.deepEqual(response.body.data.map((row: { attemptId: string }) => row.attemptId), [retake]);
    assert.equal((await candidate.get(`${myResults}/${first}`)).status, 200);

    const another = await fixture(1);
    const recent = await seedEvaluationAttempt(another, candidateId);
    const posted = await examiner.post(release(another.id));
    assert.equal(posted.status, 200, posted.text);
    const firstPage = await candidate.get(`${myResults}?pageSize=1`);
    assert.equal(firstPage.body.data[0].attemptId, recent);
    const remaining = await candidate.get(`${myResults}?cursor=${firstPage.body.meta.nextCursor}`);
    assert.equal(remaining.status, 200, remaining.text);
    assert.deepEqual(remaining.body.data.map((row: { attemptId: string }) => row.attemptId), [retake]);
  });

  it("aggregates policy scores and flags comparable papers with enough peer evidence", async () => {
    const empty = await examiner.get(analytics(exam.id));
    assert.equal(empty.status, 200, empty.text);
    assert.equal(empty.body.data.scores.count, 0);
    assert.equal(empty.body.data.scores.median, null);
    assert.equal(empty.body.data.fairness.papers.length, 0);
    const hard: string[] = [];
    const easy: string[] = [];

    for (let attemptNumber = 1; attemptNumber <= 4; attemptNumber++) {
      const h = await seedEvaluationAttempt(exam, candidateId, { attemptNumber });
      const e = await seedEvaluationAttempt(exam, secondId, { attemptNumber });
      await sql('DELETE FROM "AttemptQuestion" WHERE ("attemptId" = $1 AND position = 2) OR ("attemptId" = $2 AND position = 3)', [h, e]);
      await sql('UPDATE "Attempt" SET "maxScore" = 2.6 WHERE id = ANY($1)', [[h, e]]);
      await mark(h, 3, 0);
      await mark(e, 2, 2.5);
      hard.push(h);
      easy.push(e);
      if (attemptNumber === 1) {
        const early = await examiner.get(analytics(exam.id));
        assert.equal(early.status, 200, early.text);
        assert.equal(early.body.data.fairness.comparablePapers, 0);
        assert.equal(early.body.data.fairness.papers[0].flag, null);
      }
    }

    const response = await examiner.get(`${analytics(exam.id)}?pageSize=4`);
    assert.equal(response.status, 200, response.text);
    const { scores, fairness } = response.body.data;
    assert.deepEqual({ ...scores, distribution: scores.distribution.map((entry: { count: number }) => entry.count) }, {
      count: 2, mean: 1.35, median: 1.35, min: 0.1, max: 2.6, distribution: [1, 0, 0, 0, 1],
    });
    assert.equal(fairness.comparablePapers, 8);
    const next = await examiner.get(`${analytics(exam.id)}?cursor=${fairness.meta.nextCursor}`);
    assert.equal(next.status, 200, next.text);
    const papers = [...fairness.papers, ...next.body.data.fairness.papers];
    assert.equal(papers.length, 8);
    for (const { attemptId, questionCount, comparedQuestions, flag } of papers) {
      assert.equal(questionCount, 2);
      assert.equal(comparedQuestions, 2);
      assert.equal(flag, hard.includes(attemptId) ? "HARDER" : "EASIER");
      assert.ok(hard.includes(attemptId) || easy.includes(attemptId));
    }
    assert.deepEqual(await sql(
      'SELECT score::float8 AS score, count(*)::int AS count FROM "Attempt" WHERE "examId" = $1 GROUP BY score ORDER BY score', [exam.id],
    ), [{ score: 0.1, count: 4 }, { score: 2.6, count: 4 }]);
  });

  it("counts closed question servings, skipped responses, correct answers, wrong options and time", async () => {
    const ids: string[] = [];
    for (let attemptNumber = 1; attemptNumber <= 4; attemptNumber++) {
      ids.push(await seedEvaluationAttempt(exam, candidateId, { attemptNumber }));
    }
    await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 5, isSandbox: true });
    await seedEvaluationAttempt(exam, candidateId, { attemptNumber: 6, status: "IN_PROGRESS" });
    const question = exam.questions[0];
    const wrong = question.snapshot.options[1];
    await sql('UPDATE "AttemptQuestion" SET "timeSpentSeconds" = 10 WHERE "attemptId" = $1 AND position = 1', [ids[0]]);
    await sql('UPDATE "AttemptQuestion" SET "timeSpentSeconds" = 14, "autoScore" = 0, "selectedOptionIds" = $2 WHERE "attemptId" = $1 AND position = 1',
      [ids[1], [wrong.id]]);
    await sql('UPDATE "AttemptQuestion" SET "autoScore" = 0, "selectedOptionIds" = ARRAY[]::text[] WHERE "attemptId" = $1 AND position = 1', [ids[2]]);
    await sql(`UPDATE "AttemptQuestion" SET "selectedOptionIds" = $2,
      snapshot = jsonb_set(snapshot, '{alsoAccepted}', $3::jsonb) WHERE "attemptId" = $1 AND position = 1`, [ids[3], [wrong.id], JSON.stringify([[wrong.id]])]);

    const response = await examiner.get(`${analytics(exam.id)}/questions?pageSize=1`);
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.data, [{
      questionId: question.id, text: question.snapshot.text, labelledDifficulty: "MEDIUM",
      served: 4, skipped: 1, correct: 2, correctRate: 0.5, averageTimeSeconds: 6,
      meanMarkFraction: 0.5, observedDifficulty: "MEDIUM", mostChosenWrongOption: { id: wrong.id, text: wrong.text, count: 1 },
    }]);
    const written = await examiner.get(`${analytics(exam.id)}/questions?cursor=${response.body.meta.nextCursor}`);
    assert.equal(written.status, 200, written.text);
    assert.equal(written.body.data[1].skipped, 4);
    assert.equal(written.body.data[1].correct, null);
    assert.equal(written.body.data[1].observedDifficulty, null);
    assert.equal(written.body.meta.nextCursor, null);
  });
});
