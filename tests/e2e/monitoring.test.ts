import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "./evaluation-fixtures";
import { Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, signInAs, sql, type TempUser } from "./helpers";

let examiner: TempUser;
let otherExaminer: TempUser;
let candidate: TempUser;
let other: TempUser;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let attempt: string;

const heartbeat = (id = attempt) => "/attempts/" + id + "/heartbeat";
const incidents = (id = attempt) => "/attempts/" + id + "/incidents";
const monitor = () => "/exams/" + exam.id + "/monitor";
const announcements = () => "/exams/" + exam.id + "/announcements";
const tab = { incidents: [{ type: "TAB_HIDDEN" }] };

async function disruptions(id = attempt) {
  return sql<{ startedAt: Date; endedAt: Date | null }>(
    'SELECT "startedAt", "endedAt" FROM "Disruption" WHERE "attemptId" = $1 ORDER BY "startedAt"', [id],
  );
}

async function setLastContact(id: string, seconds: number) {
  const [row] = await sql<{ lastSeenAt: Date; deadlineAt: Date }>(
    `UPDATE "Attempt" SET "lastSeenAt" = now() - $2 * interval '1 second'
     WHERE id = $1 RETURNING "lastSeenAt", "deadlineAt"`, [id, seconds],
  );
  return row;
}

before(async () => {
  await resetRateLimits();
  examiner = await createTempUser("EXAMINER");
  otherExaminer = await createTempUser("EXAMINER");
  candidate = await createTempUser("CANDIDATE");
  other = await createTempUser("CANDIDATE");
});
beforeEach(async () => {
  await resetRateLimits();
  exam = await seedEvaluationExam(examiner.id);
  attempt = await seedEvaluationAttempt(exam, candidate.id, { status: "IN_PROGRESS" });
});
afterEach(async () => {
  if (exam) await removeEvaluationExam(exam);
});
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

it("restricts candidate and examiner operations to the right roles and owners", async () => {
  await setLastContact(attempt, 60);
  const admin = await signInAs("admin");
  for (const [client, status] of [
    [new Client(), 401], [admin, 403], [examiner.client, 403], [other.client, 404],
  ] as const) {
    assert.equal((await client.post(heartbeat())).status, status);
    assert.equal((await client.post(incidents(), tab)).status, status);
  }
  for (const [client, status] of [
    [new Client(), 401], [admin, 403], [candidate.client, 403], [otherExaminer.client, 404],
  ] as const) {
    assert.equal((await client.get(monitor())).status, status);
    assert.equal((await client.get(announcements())).status, status);
    assert.equal((await client.post(announcements(), { message: "Foreign" })).status, status);
  }
  assert.deepEqual(await disruptions(), []);
  assert.equal((await candidate.client.post(heartbeat("bad%2Fid"))).status, 404);
});

it("records a gap only after more than 45 seconds and keeps the fixed deadline", async () => {
  const before = await setLastContact(attempt, 44);
  const first = await candidate.client.post(heartbeat());
  assert.equal(first.status, 200, first.text);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.body.data.deadlineAt, before.deadlineAt.toISOString());
  assert.equal(first.body.data.status, "IN_PROGRESS");
  assert.deepEqual(await disruptions(), []);

  const stale = await setLastContact(attempt, 46);
  const replies = await Promise.all([candidate.client.post(heartbeat()), candidate.client.post(heartbeat())]);
  for (const response of replies) assert.equal(response.status, 200, response.text);
  const gaps = await disruptions();
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].startedAt.toISOString(), stale.lastSeenAt.toISOString());
  assert.ok(gaps[0].endedAt);
  const [stored] = await sql('SELECT "deadlineAt", connection FROM "Attempt" WHERE id = $1', [attempt]);
  assert.deepEqual(stored, { deadlineAt: before.deadlineAt, connection: "ONLINE" });
});

it("sweeps and reconnects idempotently and omits sandbox attempts", async () => {
  const sandbox = await seedEvaluationAttempt(exam, examiner.id, { status: "IN_PROGRESS", isSandbox: true });
  await setLastContact(sandbox, 120);
  const before = await setLastContact(attempt, 60);
  const responses = await Promise.all([examiner.client.get(monitor()), examiner.client.get(monitor())]);
  for (const response of responses) {
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.length, 1);
    assert.deepEqual(response.body.data[0], {
      id: attempt, candidate: { id: candidate.id, name: "Temp User" }, attemptNumber: 1,
      status: "IN_PROGRESS", connection: "INTERRUPTED", lastSeenAt: before.lastSeenAt.toISOString(),
      deadlineAt: before.deadlineAt.toISOString(), currentPosition: 1, questionCount: 3, answeredCount: 2,
      incidentCount: 0, disruptionCount: 1, latestDisruption: { startedAt: before.lastSeenAt.toISOString(), endedAt: null },
    });
  }
  assert.deepEqual(await disruptions(), [{ startedAt: before.lastSeenAt, endedAt: null }]);
  assert.deepEqual(await disruptions(sandbox), []);

  const reconnect = await candidate.client.post(heartbeat());
  assert.equal(reconnect.status, 200, reconnect.text);
  assert.equal(reconnect.body.data.deadlineAt, before.deadlineAt.toISOString());
  assert.deepEqual(await disruptions(), [{
    startedAt: before.lastSeenAt, endedAt: new Date(reconnect.body.data.serverTime),
  }]);
  assert.equal((await examiner.client.get(monitor())).body.data[0].connection, "ONLINE");
});

it("serializes heartbeat and monitor races without orphaned or duplicate gaps", async () => {
  await setLastContact(attempt, 90);
  const responses = await Promise.all([
    examiner.client.get(monitor()), candidate.client.post(heartbeat()), examiner.client.get(monitor()),
  ]);
  for (const response of responses) assert.equal(response.status, 200, response.text);
  const [gap, duplicate] = await disruptions();
  assert.ok(gap.endedAt);
  assert.equal(duplicate, undefined);
  assert.equal((await examiner.client.get(monitor())).body.data[0].connection, "ONLINE");
});

it("finalizes elapsed attempts without changing contact data", async () => {
  await sql(`UPDATE "Attempt" SET "deadlineAt" = now() - interval '1 second',
     "lastSeenAt" = now() - interval '60 seconds' WHERE id = $1`, [attempt]);
  const [before] = await sql<{ lastSeenAt: Date; deadlineAt: Date }>(
    'SELECT "lastSeenAt", "deadlineAt" FROM "Attempt" WHERE id = $1', [attempt],
  );
  const response = await candidate.client.post(heartbeat());
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.status, "EXPIRED");
  assert.equal((await candidate.client.post(incidents(), tab)).status, 409);
  assert.equal((await examiner.client.get(monitor())).body.data[0].status, "EXPIRED");
  const [stored] = await sql(
    'SELECT status, "gradingStatus", "submittedAt", "lastSeenAt", "deadlineAt" FROM "Attempt" WHERE id = $1', [attempt],
  );
  assert.deepEqual(stored, { ...before, status: "EXPIRED", gradingStatus: "NEEDS_REVIEW", submittedAt: before.deadlineAt });
  assert.equal((await examiner.client.get(`/exams/${exam.id}/grading`)).body.data.length, 2);
  assert.deepEqual(await disruptions(), []);
});

it("pages monitor rows and returns only aggregate signal and progress fields", async () => {
  const submitted = await seedEvaluationAttempt(exam, other.id);
  const signal = await candidate.client.post(incidents(), tab);
  assert.equal(signal.status, 201, signal.text);
  const first = await examiner.client.get(monitor() + "?pageSize=1");
  assert.equal(first.status, 200, first.text);
  const next = await examiner.client.get(monitor() + "?pageSize=1&cursor=" + first.body.meta.nextCursor);
  assert.equal(next.status, 200, next.text);
  const rows = [...first.body.data, ...next.body.data];
  assert.deepEqual(new Set(rows.map(({ id }) => id)), new Set([attempt, submitted]));
  assert.equal(rows.find(({ id }) => id === attempt).incidentCount, 1);
  assert.equal(next.body.meta.nextCursor, null);
  assert.equal((await examiner.client.get(monitor() + "?pageSize=201")).status, 422);
});

it("publishes announcements in delivery order and only to the corresponding exam", async () => {
  const otherExam = await seedEvaluationExam(examiner.id);
  try {
    const otherAttempt = await seedEvaluationAttempt(otherExam, other.id, { status: "IN_PROGRESS" });
    const results = await Promise.all([
      examiner.client.post(announcements(), { message: "  First tab  " }),
      examiner.client.post(announcements(), { message: "Second tab" }),
    ]);
    for (const response of results) assert.equal(response.status, 201, response.text);
    assert.deepEqual(new Set(results.map(({ body }) => body.data.message)), new Set(["First tab", "Second tab"]));
    assert.notEqual(results[0].body.data.createdAt, results[1].body.data.createdAt);
    for (let index = 0; index < 19; index++) {
      assert.equal((await examiner.client.post(announcements(), { message: "Update " + index })).status, 201);
    }
    const first = await candidate.client.post(heartbeat());
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.data.announcements.length, 20);
    assert.equal(first.body.data.hasMoreAnnouncements, true);
    const cursor = first.body.data.announcementCursor;
    const next = await candidate.client.post(heartbeat() + "?cursor=" + cursor);
    assert.equal(next.status, 200, next.text);
    assert.equal(next.body.data.hasMoreAnnouncements, false);
    assert.deepEqual(next.body.data.announcements.map(({ message }: { message: string }) => message), ["Update 18"]);
    const current = next.body.data.announcementCursor;
    assert.equal((await candidate.client.post(heartbeat() + "?cursor=" + current)).body.data.announcementCursor, current);
    assert.deepEqual((await other.client.post(heartbeat(otherAttempt))).body.data.announcements, []);

    const page = await examiner.client.get(announcements() + "?pageSize=1");
    assert.deepEqual(page.body.data, first.body.data.announcements.slice(0, 1));
    const rest = await examiner.client.get(announcements() + "?cursor=" + page.body.meta.nextCursor);
    assert.equal(rest.body.data.length, 20);
    assert.equal((await candidate.client.post(heartbeat() + "?cursor=invalid")).status, 422);
    assert.equal((await examiner.client.post(announcements(), { message: " " })).status, 422);
    assert.equal((await examiner.client.post(announcements(), { message: "A".repeat(1001) })).status, 422);
  } finally {
    await removeEvaluationExam(otherExam);
  }
});

it("records an allowed batch with server-controlled metadata and own question links", async () => {
  const before = Date.now();
  const response = await candidate.client.post(incidents(), {
    incidents: [
      { type: "TAB_HIDDEN", details: { awayMs: 1000 } },
      { type: "COPY_ATTEMPT", details: { position: 1 } },
      { type: "DEVTOOLS_SHORTCUT", details: { key: "F12" } },
    ],
  });
  assert.equal(response.status, 201, response.text);
  assert.deepEqual(response.body, { data: { accepted: 3 } });
  const stored = await sql<{ source: string; severity: string; createdAt: Date; attemptQuestionId: string | null; type: string; details: unknown }>(
    'SELECT source, severity, "createdAt", "attemptQuestionId", type, details FROM "Incident" WHERE "attemptId" = $1', [attempt],
  );
  assert.equal(stored.length, 3);
  for (const event of stored) {
    assert.equal(event.source, "CLIENT");
    assert.equal(event.severity, "LOW");
    assert.ok(event.createdAt.getTime() >= before && event.createdAt.getTime() <= Date.now());
  }
  assert.equal(stored.find(({ type }) => type === "COPY_ATTEMPT")?.attemptQuestionId, attempt + "-answer-1");
  assert.deepEqual(stored.find(({ type }) => type === "TAB_HIDDEN")?.details, { awayMs: 1000 });
});

it("rejects forged, disabled and oversized incident batches and rate-limits intake", async () => {
  for (const body of [
    { incidents: [{ type: "PASTE_BYPASS" }] },
    { incidents: [{ type: "TAB_HIDDEN", source: "SERVER" }] },
    { incidents: [{ type: "TAB_HIDDEN", createdAt: "2000-01-01" }] },
    { incidents: [{ type: "FULLSCREEN_EXIT" }] },
    { incidents: [{ type: "COPY_ATTEMPT", details: { position: 99 } }] },
    { incidents: [{ type: "FOCUS_LOST", details: { awayMs: -1 } }] },
    { incidents: [{ type: "DEVTOOLS_SHORTCUT", details: { key: "arbitrary keystrokes" } }] },
    { incidents: Array.from({ length: 21 }, () => ({ type: "TAB_HIDDEN" })) },
  ]) {
    const response = await candidate.client.post(incidents(), body);
    assert.equal(response.status, 422, response.text);
  }
  assert.deepEqual(await sql('SELECT id FROM "Incident" WHERE "attemptId" = $1', [attempt]), []);
  for (let index = 0; index < 4; index++) assert.equal((await candidate.client.post(incidents(), tab)).status, 201);
  const limited = await candidate.client.post(incidents(), tab);
  assert.equal(limited.status, 429, limited.text);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
