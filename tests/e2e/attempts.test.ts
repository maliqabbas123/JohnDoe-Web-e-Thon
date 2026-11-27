import assert from "node:assert/strict";
import { after, before, beforeEach, it } from "node:test";
import { Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, sql, type TempUser } from "./helpers";

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.now() + minutes * MINUTE).toISOString();
const attempt = (id: string) => `/attempts/${id}`;
let examiner: TempUser;
let candidate: TempUser;
let outsider: TempUser;
let choice: string;
let right: string;
let wrong: string;
let written: string;

async function exam(publish: boolean, includeWritten = false) {
  const created = await examiner.client.post("/exams", {
    title: "Demo paper", startsAt: at(30), endsAt: at(90),
    durationMinutes: 30, totalMarks: includeWritten ? 5.5 : 2.5,
  });
  assert.equal(created.status, 201, created.text);
  const id = created.body.data.id as string;
  const questions = [{ questionId: choice, marks: 2.5 }];
  if (includeWritten) questions.push({ questionId: written, marks: 3 });
  const pool = await examiner.client.request("PUT", `/exams/${id}/questions`, { json: { questions } });
  assert.equal(pool.status, 200, pool.text);
  if (publish) {
    assert.equal((await examiner.client.post(`/exams/${id}/publish`)).status, 200);
    assert.equal((await examiner.client.post(`/exams/${id}/enrollments`, { emails: [candidate.email] })).status, 200);
    await sql(`UPDATE "Exam" SET "startsAt" = now() - interval '1 hour', "endsAt" = now() + interval '5 minutes' WHERE id = $1`, [id]);
  }
  return id;
}

const start = (id: string) => candidate.client.post(`/exams/${id}/attempts`, { rulesAccepted: true });
const save = (id: string, position: number, json: unknown) =>
  candidate.client.request("PUT", `${attempt(id)}/answers/${position}`, { json });

before(async () => {
  await resetRateLimits();
  examiner = await createTempUser("EXAMINER");
  candidate = await createTempUser();
  outsider = await createTempUser();
  const topic = await examiner.client.post("/topics", { name: "Attempt tests" });
  assert.equal(topic.status, 201, topic.text);
  const topicId = topic.body.data.id;
  const objective = await examiner.client.post("/questions", {
    topicId, type: "SINGLE_CHOICE", difficulty: "EASY", text: "Original question", defaultMarks: 2.5,
    options: [{ text: "First", isCorrect: true }, { text: "Second", isCorrect: false }],
  });
  assert.equal(objective.status, 201, objective.text);
  choice = objective.body.data.id;
  right = objective.body.data.options[0].id;
  wrong = objective.body.data.options[1].id;
  const response = await examiner.client.post("/questions", {
    topicId, type: "WRITTEN", difficulty: "HARD", text: "Explain your answer", defaultMarks: 3,
  });
  assert.equal(response.status, 201, response.text);
  written = response.body.data.id;
});

beforeEach(resetRateLimits);
after(async () => {
  try {
    if (examiner) await sql('DELETE FROM "Attempt" WHERE "examId" IN (SELECT id FROM "Exam" WHERE "ownerId" = $1)', [examiner.id]);
    await removeTempUsers();
  } finally {
    await closeDatabase();
  }
});

it("starts one attempt under a race and freezes the paper and deadline", async () => {
  const examId = await exam(true);
  assert.equal((await new Client().post(`/exams/${examId}/attempts`, { rulesAccepted: true })).status, 401);
  assert.equal((await outsider.client.post(`/exams/${examId}/attempts`, { rulesAccepted: true })).status, 404);
  assert.equal((await candidate.client.post(`/exams/${examId}/attempts`, { rulesAccepted: false })).status, 422);
  assert.equal((await candidate.client.post(`/exams/${examId}/attempts`, { rulesAccepted: true }, {
    headers: { "User-Agent": "iPhone Mobile" },
  })).status, 403);
  const starts = await Promise.all([start(examId), start(examId)]);
  assert.deepEqual(starts.map(({ status }) => status).sort(), [200, 201]);
  const [first, second] = starts.map(({ body }) => body.data);
  assert.equal(first.id, second.id);
  assert.equal(first.deadlineAt, second.deadlineAt);
  const [row] = await sql<{ endsAt: Date }>('SELECT "endsAt" FROM "Exam" WHERE id = $1', [examId]);
  assert.equal(first.deadlineAt, row.endsAt.toISOString());

  assert.equal((await examiner.client.patch(`/questions/${choice}`, { text: "Edited in bank" })).status, 200);
  const question = await candidate.client.get(`${attempt(first.id)}/questions/1`);
  assert.equal(question.status, 200, question.text);
  assert.equal(question.headers.get("cache-control"), "no-store");
  assert.equal(question.body.data.text, "Original question");
  assert.deepEqual(question.body.data.options, [{ id: right, text: "First" }, { id: wrong, text: "Second" }]);
  assert.ok(question.body.data.aiNotice);
  assert.ok(question.body.data.honeypot);
  assert.equal((await outsider.client.get(attempt(first.id))).status, 404);
  assert.equal((await examiner.client.get(attempt(first.id))).status, 404);
  await examiner.client.patch(`/questions/${choice}`, { text: "Original question" });
});

it("keeps the newest answer, expires a late save and preserves objective scores", async () => {
  const examId = await exam(true);
  const started = await start(examId);
  assert.equal(started.status, 201, started.text);
  const id = started.body.data.id;
  assert.equal((await save(id, 1, { revision: 1, selectedOptionIds: ["unknown-option"] })).status, 422);
  assert.equal((await save(id, 1, { revision: 1, selectedOptionIds: [right, wrong] })).status, 422);
  const newest = await save(id, 1, { revision: 2, selectedOptionIds: [right], flagged: true });
  assert.equal(newest.status, 200, newest.text);
  assert.equal(newest.body.data.accepted, true);
  const stale = await save(id, 1, { revision: 1, selectedOptionIds: [wrong] });
  assert.equal(stale.body.data.accepted, false);
  const [expiredAt] = await sql<{ deadlineAt: Date }>(
    `UPDATE "Attempt" SET "deadlineAt" = now() - interval '1 second' WHERE id = $1 RETURNING "deadlineAt"`, [id],
  );
  const late = await save(id, 1, { revision: 3, selectedOptionIds: [wrong] });
  assert.equal(late.status, 409, late.text);
  const [row] = await sql<{ status: string; submittedAt: Date; score: string; gradingStatus: string }>(
    'SELECT status, "submittedAt", score, "gradingStatus" FROM "Attempt" WHERE id = $1', [id],
  );
  assert.equal(row.status, "EXPIRED");
  assert.deepEqual(row.submittedAt, expiredAt.deadlineAt);
  assert.equal(Number(row.score), 2.5);
  assert.equal(row.gradingStatus, "GRADED");
  const [stored] = await sql<{ selectedOptionIds: string[] }>('SELECT "selectedOptionIds" FROM "AttemptQuestion" WHERE "attemptId" = $1', [id]);
  assert.deepEqual(stored.selectedOptionIds, [right]);
  assert.equal((await candidate.client.get(`${attempt(id)}/questions/1`)).status, 409);
  const detail = await candidate.client.get(attempt(id));
  assert.equal(detail.body.data.status, "EXPIRED");
  assert.equal(detail.body.data.questions[0].flagged, true);
  assert.equal((await start(examId)).status, 409);
});

it("records question navigation and puts written answers into the existing grading queue once", async () => {
  const examId = await exam(true, true);
  const started = await start(examId);
  assert.equal(started.status, 201, started.text);
  const id = started.body.data.id;
  assert.equal((await candidate.client.get(`${attempt(id)}/questions/1`)).status, 200);
  await sql(`UPDATE "Attempt" SET "currentOpenedAt" = now() - interval '3 seconds' WHERE id = $1`, [id]);
  assert.equal((await candidate.client.get(`${attempt(id)}/questions/2`)).status, 200);
  const [timing] = await sql<{ openCount: number; timeSpentSeconds: number }>(
    'SELECT "openCount", "timeSpentSeconds" FROM "AttemptQuestion" WHERE "attemptId" = $1 AND position = 1', [id],
  );
  assert.equal(timing.openCount, 1);
  assert.ok(timing.timeSpentSeconds >= 3);
  assert.equal((await save(id, 2, { revision: 1, writtenAnswer: "Because of the rule", keystrokeCount: 19 })).status, 200);
  assert.equal((await candidate.client.request("PUT", `${attempt(id)}/scratchpad`, { json: { text: "work" } })).status, 200);
  assert.equal((await candidate.client.get(attempt(id))).body.data.scratchpad, "work");

  const results = await Promise.all([
    candidate.client.post(`${attempt(id)}/submit`),
    candidate.client.post(`${attempt(id)}/submit`),
  ]);
  assert.ok(results.every(({ status }) => status === 200));
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal(results[0].body.data.status, "SUBMITTED");
  const queue = await examiner.client.get(`/exams/${examId}/grading`);
  assert.equal(queue.status, 200, queue.text);
  assert.equal(queue.body.data.length, 1);
  assert.equal(queue.body.data[0].attemptId, id);
  assert.equal(queue.body.data[0].position, 2);
});

it("previews and resets a draft as its examiner without exposing it to grading or candidates", async () => {
  const examId = await exam(false);
  const preview = await examiner.client.post(`/exams/${examId}/sandbox`);
  assert.equal(preview.status, 201, preview.text);
  const id = preview.body.data.id;
  assert.equal(preview.body.data.isSandbox, true);
  assert.equal((await candidate.client.get(attempt(id))).status, 404);
  assert.equal((await examiner.client.get(`${attempt(id)}/questions/1`)).status, 200);
  assert.equal((await examiner.client.post(`${attempt(id)}/submit`)).status, 200);
  assert.equal((await examiner.client.get(`/exams/${examId}/grading`)).body.data.length, 0);
  assert.equal((await examiner.client.delete(`/exams/${examId}/sandbox`)).status, 204);
  assert.equal((await examiner.client.get(attempt(id))).status, 404);
});
