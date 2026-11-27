import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, scalar, signInAs, sql, type TempUser,
} from "./helpers";

const HOUR = 60 * 60 * 1000;
const clock = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString();
const roster = (id: string) => `/exams/${id}/enrollments`;
const grants = (id: string) => `/exams/${id}/retake-grants`;
const myExam = (id: string) => `/me/exams/${id}`;

let owner: TempUser;
let other: TempUser;
let candidate: TempUser;
let second: TempUser;
let administrator: Client;
let questionId: string;

async function createExam(published = true) {
  const made = await owner.client.post("/exams", {
    title: "Enrolment exam", instructions: "Answer the question.",
    startsAt: clock(1), endsAt: clock(2), durationMinutes: 30, totalMarks: 4,
  });
  assert.equal(made.status, 201, made.text);
  const id = made.body.data.id as string;
  if (published) {
    const questions = await owner.client.request("PUT", `/exams/${id}/questions`, {
      json: { questions: [{ questionId, marks: 4 }] },
    });
    assert.equal(questions.status, 200, questions.text);
    const published = await owner.client.post(`/exams/${id}/publish`);
    assert.equal(published.status, 200, published.text);
  }
  return id;
}

async function enrol(id: string, ...people: TempUser[]) {
  const response = await owner.client.post(roster(id), { emails: people.map(({ email }) => email) });
  assert.equal(response.status, 200, response.text);
}

const retake = (person = candidate) => ({
  candidateId: person.id, startsAt: clock(3), endsAt: clock(4), reason: "Approved replacement slot",
});

async function insertAttempt(id: string, options: { retakeId?: string; sandbox?: boolean; deadline?: string } = {}) {
  const [row] = await sql<{ id: string }>(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", "deadlineAt", "rulesAcceptedAt", "maxScore", "retakeGrantId", "isSandbox")
     VALUES (gen_random_uuid()::text, $1, $2,
       (SELECT count(*) + 1 FROM "Attempt" WHERE "examId" = $1 AND "userId" = $2),
       $3::timestamptz, now(), 4, $4, $5) RETURNING id`,
    [id, candidate.id, options.deadline ?? clock(0.5), options.retakeId ?? null, options.sandbox ?? false],
  );
  return row.id;
}

before(async () => {
  await resetRateLimits();
  owner = await createTempUser("EXAMINER");
  other = await createTempUser("EXAMINER");
  candidate = await createTempUser();
  second = await createTempUser();
  administrator = await signInAs("admin");
  const topic = await owner.client.post("/topics", { name: "Enrolment test" });
  assert.equal(topic.status, 201, topic.text);
  const question = await owner.client.post("/questions", {
    topicId: topic.body.data.id, type: "WRITTEN", difficulty: "EASY", text: "Explain.", defaultMarks: 4,
  });
  assert.equal(question.status, 201, question.text);
  questionId = question.body.data.id;
});

beforeEach(resetRateLimits);
after(async () => {
  try {
    if (owner) {
      await sql('DELETE FROM "Attempt" WHERE "examId" IN (SELECT id FROM "Exam" WHERE "ownerId" = $1)', [owner.id]);
      await sql('DELETE FROM "AuditLog" WHERE "actorId" = $1 AND action = $2', [owner.id, "RETAKE_GRANTED"]);
    }
    await removeTempUsers();
  } finally {
    await closeDatabase();
  }
});

describe("exam enrolment access", () => {
  it("requires the right role and hides other examiners' exams", async () => {
    const id = await createExam();
    const guest = new Client();
    const examinerRoutes: [string, string, unknown?][] = [
      ["GET", roster(id)], ["POST", roster(id), { emails: [candidate.email] }],
      ["DELETE", `${roster(id)}/${candidate.id}`], ["GET", grants(id)], ["POST", grants(id), retake()],
    ];
    for (const [method, path, json] of examinerRoutes) {
      for (const [client, status] of [[guest, 401], [candidate.client, 403], [administrator, 403], [other.client, 404]] as const) {
        assert.equal((await client.request(method, path, { json })).status, status, `${method} ${path}`);
      }
    }
    for (const [method, path, json] of [
      ["GET", "/me/exams"], ["GET", myExam(id)], ["POST", "/me/exams/join", { code: "a".repeat(32) }],
    ] as [string, string, unknown?][]) {
      assert.equal((await guest.request(method, path, { json })).status, 401);
      for (const client of [owner.client, administrator]) {
        assert.equal((await client.request(method, path, { json })).status, 403);
      }
    }
    assert.equal((await candidate.client.get(myExam(id))).status, 404);
  });

  it("hides enrolled drafts and restores access after publication", async () => {
    const id = await createExam();
    await enrol(id, candidate);
    assert.equal((await owner.client.post(`/exams/${id}/unpublish`)).status, 200);
    assert.equal((await candidate.client.get(myExam(id))).status, 404);
    const hidden = await candidate.client.get("/me/exams?pageSize=100");
    assert.ok(!hidden.body.data.some((row: { id: string }) => row.id === id));
    assert.equal((await owner.client.post(`/exams/${id}/publish`)).status, 200);
    assert.equal((await candidate.client.get(myExam(id))).status, 200);
    assert.equal((await second.client.get(myExam(id))).status, 404);
  });
});

describe("rosters and joining", () => {
  it("normalizes emails and reports one outcome per entry without exposing other account details", async () => {
    const id = await createExam(false);
    const missing = "absent-enrolment@exam.test";
    const response = await owner.client.post(roster(id), {
      emails: [` ${candidate.email.toUpperCase()} `, other.email, missing, candidate.email, second.email],
    });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.data, [
      { email: candidate.email, status: "ENROLLED" },
      { email: other.email, status: "NOT_A_REGISTERED_CANDIDATE" },
      { email: missing, status: "NOT_A_REGISTERED_CANDIDATE" },
      { email: candidate.email, status: "ALREADY_ENROLLED" },
      { email: second.email, status: "ENROLLED" },
    ]);

    const rows = await owner.client.get(`${roster(id)}?pageSize=1`);
    assert.equal(rows.status, 200, rows.text);
    assert.deepEqual(rows.body.meta, { page: 1, pageSize: 1, total: 2 });
    assert.deepEqual(Object.keys(rows.body.data[0]).sort(), ["candidate", "createdAt"]);
    assert.deepEqual(Object.keys(rows.body.data[0].candidate).sort(), ["email", "id", "name"]);
    assert.equal((await owner.client.get(`${roster(id)}?q=candidate`)).status, 422);
  });

  it("accepts 500 long addresses and rejects oversized, malformed and cross-origin requests", async () => {
    const id = await createExam(false);
    const email = `${"a".repeat(63)}@${"a".repeat(63)}.${"b".repeat(63)}.${"c".repeat(59)}.io`;
    const maxBatch = Array<string>(500).fill(email);
    const response = await owner.client.post(roster(id), { emails: maxBatch });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.length, 500);
    for (const json of [{ emails: [] }, { emails: Array(501).fill(candidate.email) }, { emails: ["not an email"] }, { emails: [candidate.email], ownerId: other.id }]) {
      assert.equal((await owner.client.post(roster(id), json)).status, 422);
    }
    assert.equal((await owner.client.post(roster(id), { emails: ["0".repeat(132_000)] })).status, 413);
    assert.equal((await owner.client.post(roster(id), { emails: ["bad\u0000address"] })).status, 400);
    assert.equal((await owner.client.post(roster(id), { emails: [candidate.email] }, { headers: { Origin: "https://other.example" } })).status, 403);
  });

  it("inserts one enrolment for concurrent enrol calls", async () => {
    const id = await createExam(false);
    const attempts = await Promise.all([
      owner.client.post(roster(id), { emails: [candidate.email] }),
      owner.client.post(roster(id), { emails: [candidate.email] }),
    ]);
    assert.deepEqual(attempts.map((response) => response.body.data[0].status).sort(), ["ALREADY_ENROLLED", "ENROLLED"]);
    assert.equal(await scalar('SELECT count(*)::int FROM "Enrollment" WHERE "examId" = $1', [id]), 1);
  });

  it("blocks removal after a real attempt and removes an unused enrolment and its grants", async () => {
    const id = await createExam();
    await enrol(id, candidate, second);
    await insertAttempt(id);
    assert.equal((await owner.client.delete(`${roster(id)}/${candidate.id}`)).status, 409);
    assert.equal((await owner.client.post(grants(id), retake(second))).status, 201);
    assert.equal((await owner.client.delete(`${roster(id)}/${second.id}`)).status, 204);
    assert.equal((await owner.client.delete(`${roster(id)}/${second.id}`)).status, 404);
    assert.equal((await second.client.get(myExam(id))).status, 404);
    assert.equal((await owner.client.get(grants(id))).body.meta.total, 0);
  });

  it("joins once for concurrent code requests, rotating and disabling codes immediately", async () => {
    const id = await createExam();
    const issued = await owner.client.post(`/exams/${id}/join-code`);
    const oldCode = issued.body.data.joinCode;
    const newer = await owner.client.post(`/exams/${id}/join-code`);
    const code = newer.body.data.joinCode;
    const wrong = await candidate.client.post("/me/exams/join", { code: oldCode });
    assert.equal(wrong.status, 404);
    const joins = await Promise.all([
      candidate.client.post("/me/exams/join", { code: ` ${code.toUpperCase()} ` }),
      candidate.client.post("/me/exams/join", { code }),
    ]);
    assert.ok(joins.every((result) => result.status === 200 && result.body.data.examId === id));
    assert.deepEqual(joins.map((result) => result.body.data.status).sort(), ["ALREADY_ENROLLED", "ENROLLED"]);
    assert.equal((await owner.client.delete(`/exams/${id}/join-code`)).status, 204);
    const disabled = await candidate.client.post("/me/exams/join", { code });
    assert.equal(disabled.status, wrong.status);
    assert.deepEqual(disabled.body, wrong.body);
    assert.equal((await candidate.client.get(myExam(id))).status, 200);
  });

  it("hides draft and closed codes and limits guesses per candidate until the window resets", async () => {
    const id = await createExam(false);
    const { body } = await owner.client.post(`/exams/${id}/join-code`);
    const { joinCode: code } = body.data;
    for (const state of ["DRAFT", "COMPLETED", "PUBLISHED"]) {
      await sql(
        `UPDATE "Exam" SET status = $2::"ExamStatus", "startsAt" = now() - interval '2 hours', "endsAt" = now() - interval '1 hour' WHERE id = $1`,
        [id, state],
      );
      assert.equal((await candidate.client.post("/me/exams/join", { code })).status, 404);
    }
    for (let i = 0; i < 7; i++) {
      assert.equal((await candidate.client.post("/me/exams/join", { code: "abc" })).status, 404);
    }
    const limited = await candidate.client.post("/me/exams/join", { code });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get("retry-after")) > 0);
    assert.equal((await second.client.post("/me/exams/join", { code })).status, 404);
    await sql('UPDATE "RateLimit" SET "resetAt" = now() WHERE key = $1', [`join-exam:${candidate.id}`]);
    assert.equal((await candidate.client.post("/me/exams/join", { code })).status, 404);
  });
});

describe("retakes and candidate availability", () => {
  it("validates and audits a named grant without exposing it to another candidate", async () => {
    const id = await createExam();
    await enrol(id, candidate, second);
    for (const change of [{ reason: " " }, { endsAt: clock(2) }, { attemptsAllowed: 0 }, { startsAt: "tomorrow" }, { candidateId: "%00" }]) {
      assert.equal((await owner.client.post(grants(id), { ...retake(), ...change })).status, 422);
    }
    assert.equal((await owner.client.post(grants(id), { ...retake(), candidateId: other.id })).status, 404);
    await sql('UPDATE "Exam" SET status = $2 WHERE id = $1', [id, "COMPLETED"]);
    const created = await owner.client.post(grants(id), retake());
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.data.attemptsAllowed, 1);
    const listed = await owner.client.get(grants(id));
    assert.deepEqual(listed.body.data, [created.body.data]);
    const audit = await sql<{ metadata: Record<string, unknown> }>(
      'SELECT metadata FROM "AuditLog" WHERE action = $1 AND "entityId" = $2 AND "actorId" = $3',
      ["RETAKE_GRANTED", id, owner.id],
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].metadata.reason, retake().reason);
    assert.equal(audit[0].metadata.grantId, created.body.data.id);

    const own = await candidate.client.get(myExam(id));
    const otherCandidate = await second.client.get(myExam(id));
    assert.equal(own.body.data.status, "UPCOMING");
    assert.equal(own.body.data.slot.retakeGrantId, created.body.data.id);
    assert.equal(otherCandidate.body.data.status, "COMPLETED");
    assert.equal(otherCandidate.body.data.slot, null);
    assert.ok(!own.text.includes(retake().reason));
  });

  it("shows active and expired attempts, uses separate counters and omits paper and code data", async () => {
    const id = await createExam();
    await enrol(id, candidate);
    await owner.client.post(`/exams/${id}/join-code`);
    const upcoming = await candidate.client.get(myExam(id));
    assert.equal(upcoming.status, 200, upcoming.text);
    assert.equal(upcoming.body.data.status, "UPCOMING");
    await sql(`UPDATE "Exam" SET "startsAt" = now() - interval '1 hour', "endsAt" = now() + interval '1 hour' WHERE id = $1`, [id]);
    assert.equal((await candidate.client.get(myExam(id))).body.data.status, "AVAILABLE");
    const sandbox = await insertAttempt(id, { sandbox: true });
    assert.equal((await candidate.client.get(myExam(id))).body.data.totalAttemptsUsed, 0);
    await sql('DELETE FROM "Attempt" WHERE id = $1', [sandbox]);

    const attempt = await insertAttempt(id);
    const active = await candidate.client.get(myExam(id));
    assert.equal(active.body.data.status, "IN_PROGRESS");
    assert.equal(active.body.data.activeAttemptId, attempt);
    assert.ok(active.body.data.deadlineAt);
    assert.equal(active.body.data.attemptsUsed, 1);
    assert.equal(active.body.data.instructions, "Answer the question.");
    assert.ok(active.body.data.rules.statements.length > 0);
    for (const key of ["joinCode", "questions", "difficultyRules", "isCorrect", "ownerId"]) {
      assert.ok(!Object.hasOwn(active.body.data, key), key);
    }
    await sql(`UPDATE "Attempt" SET "deadlineAt" = now() - interval '1 second' WHERE id = $1`, [attempt]);
    const expired = await candidate.client.get(myExam(id));
    assert.equal(expired.body.data.status, "COMPLETED");
    assert.equal(expired.body.data.activeAttemptId, null);

    const grant = await owner.client.post(grants(id), { ...retake(), startsAt: clock(-0.25), endsAt: clock(0.5) });
    assert.equal(grant.status, 201, grant.text);
    const afterGrant = await candidate.client.get("/me/exams?pageSize=100");
    const exam = afterGrant.body.data.find((row: { id: string }) => row.id === id);
    assert.equal(exam.status, "AVAILABLE");
    assert.equal(exam.slot.retakeGrantId, grant.body.data.id);
    assert.equal(exam.slot.attemptsUsed, 0);

    await sql(`UPDATE "Attempt" SET status = 'EXPIRED' WHERE id = $1`, [attempt]);
    await insertAttempt(id, { retakeId: grant.body.data.id, deadline: clock(-0.1) });
    const exhausted = await candidate.client.get(myExam(id));
    assert.equal(exhausted.body.data.status, "COMPLETED");
    assert.equal(exhausted.body.data.attemptsUsed, 1);
    assert.equal(exhausted.body.data.totalAttemptsUsed, 2);
  });
});
