import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "./evaluation-fixtures";
import { Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, signInAs, sql, type TempUser } from "./helpers";

let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let examiner: TempUser;
let stranger: TempUser;
let candidate: TempUser;
let attempt: string;
let peer: string;
const path = () => "/attempts/" + attempt + "/integrity";
const note = "Check the saved evidence with the candidate.";

before(async () => {
  await resetRateLimits();
  examiner = await createTempUser("EXAMINER");
  stranger = await createTempUser("EXAMINER");
  candidate = await createTempUser("CANDIDATE");
  const other = await createTempUser("CANDIDATE");
  exam = await seedEvaluationExam(examiner.id, 10);
  attempt = await seedEvaluationAttempt(exam, candidate.id);
  peer = await seedEvaluationAttempt(exam, other.id);
});
after(async () => {
  if (exam) await removeEvaluationExam(exam);
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

it("rejects unauthenticated, candidate, admin and foreign examiner access", async () => {
  for (const [client, status] of [
    [new Client(), 401], [candidate.client, 403], [await signInAs("admin"), 403], [stranger.client, 404],
  ] as const) {
    assert.equal((await client.get(path())).status, status);
    assert.equal((await client.request("PUT", path() + "/review", { json: { note } })).status, status);
  }
  const live = await seedEvaluationAttempt(exam, candidate.id, { status: "IN_PROGRESS", attemptNumber: 2 });
  const sandbox = await seedEvaluationAttempt(exam, examiner.id, { isSandbox: true });
  for (const [id, status] of [[live, 409], [sandbox, 404]] as const) {
    assert.equal((await examiner.client.get("/attempts/" + id + "/integrity")).status, status);
  }
});

it("stores all supported signals once and leaves an honest fast typist and scores alone", async () => {
  const written = "Repeated trials produce more dependable results because random variation is easier to observe when an experiment has several independent measurements.";
  const before = await sql('SELECT status, score, "gradingStatus" FROM "Attempt" WHERE id = $1', [attempt]);
  await sql(`UPDATE "Attempt" SET "honeypotMarker" = 'OnlyThisAttemptMarker' WHERE id = $1`, [attempt]);
  await sql(`UPDATE "AttemptQuestion" SET snapshot = jsonb_set(snapshot, '{difficulty}', '"HARD"'), "timeSpentSeconds" = 3
    WHERE "attemptId" = $1 AND position = 1`, [attempt]);
  await sql(`UPDATE "AttemptQuestion" SET "writtenAnswer" = $2, "keystrokeCount" = 3 WHERE "attemptId" = $1 AND position = 2`,
    [attempt, written + " OnlyThisAttemptMarker"]);
  await sql(`UPDATE "AttemptQuestion" SET "writtenAnswer" = $2, "keystrokeCount" = 230, "timeSpentSeconds" = 2
    WHERE "attemptId" = $1 AND position = 3`, [attempt, written]);
  await sql(`UPDATE "AttemptQuestion" SET "writtenAnswer" = $2 WHERE "attemptId" = $1 AND position = 2`, [peer, written]);
  await sql(`UPDATE "AttemptQuestion" SET "selectedOptionIds" = ARRAY[snapshot->'options'->1->>'id']
    WHERE "attemptId" IN ($1, $2) AND position IN (4, 7, 10)`, [attempt, peer]);

  const results = await Promise.all([examiner.client.get(path()), examiner.client.get(path())]);
  for (const response of results) {
    assert.equal(response.status, 200, response.text);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.body.data.level, "HIGH");
    const signals = response.body.data.signals;
    assert.equal(signals.length, 5);
    assert.deepEqual(response.body.data.counts, { LOW: 0, MEDIUM: 3, HIGH: 2 });
    assert.ok(signals.some((signal: { label: string }) => signal.label === "High: paste block bypassed"));
    assert.ok(signals.every((signal: { position: number }) => signal.position !== 3));
    assert.ok(!response.text.includes("OnlyThisAttemptMarker"));
    assert.ok(!response.text.includes(written));
  }
  const first = await examiner.client.get(path() + "?pageSize=2");
  const next = await examiner.client.get(path() + "?cursor=" + first.body.data.nextCursor);
  assert.equal(first.body.data.signals.length, 2);
  assert.equal(next.body.data.signals.length, 3);
  assert.equal((await sql('SELECT id FROM "Incident" WHERE "attemptId" = $1', [attempt])).length, 5);
  assert.deepEqual(await sql('SELECT status, score, "gradingStatus" FROM "Attempt" WHERE id = $1', [attempt]), before);
});

it("stores the review note with the examiner identity and server time", async () => {
  const start = Date.now();
  const invalid = await examiner.client.request("PUT", path() + "/review", { json: { note, reviewedById: stranger.id } });
  assert.equal(invalid.status, 422, invalid.text);
  const saved = await examiner.client.request("PUT", path() + "/review", { json: { note: " " + note + " " } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.data.note, note);
  assert.equal(saved.body.data.reviewedById, examiner.id);
  assert.ok(Date.parse(saved.body.data.reviewedAt) >= start);
  assert.deepEqual((await examiner.client.get(path())).body.data.review, saved.body.data);
});
