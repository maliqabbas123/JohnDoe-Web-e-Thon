import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  Client, closeDatabase, createTempUser, removeTempUsers,
  resetRateLimits, scalar, signInAs, sql, type TempUser,
} from "./helpers";

const HOUR = 60 * 60 * 1000;
let owner: TempUser;
let other: TempUser;
let candidate: TempUser;
let admin: Client;
let ownTopic: string;
let easy: string;
let medium: string;
let hard: string;
let foreign: string;

const futureExam = () => ({
  title: "Applied Mathematics",
  startsAt: new Date(Date.now() + HOUR).toISOString(),
  endsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
  durationMinutes: 60,
  totalMarks: 5.25,
});

const examPath = (id: string) => `/exams/${id}`;
const put = (id: string, segment: string, json: unknown, client = owner.client) =>
  client.request("PUT", `${examPath(id)}/${segment}`, { json });
const pool = (id: string, questions: { questionId: string; marks?: number | null }[]) =>
  put(id, "questions", { questions });

async function makeQuestion(client: Client, topicId: string, difficulty: string) {
  const response = await client.post("/questions", {
    topicId, difficulty, type: "WRITTEN", text: "Explain your reasoning.", defaultMarks: 1,
  });
  assert.equal(response.status, 201, response.text);
  return response.body.data.id as string;
}

async function makeExam(overrides: Record<string, unknown> = {}, client = owner.client) {
  const response = await client.post("/exams", { ...futureExam(), ...overrides });
  assert.equal(response.status, 201, response.text);
  return response.body.data.id as string;
}

async function publishFixed() {
  const id = await makeExam();
  assert.equal((await pool(id, [{ questionId: easy, marks: 5.25 }])).status, 200);
  const response = await owner.client.post(`${examPath(id)}/publish`);
  assert.equal(response.status, 200, response.text);
  return id;
}

async function moveSlot(id: string, ended = false) {
  await sql(
    `UPDATE "Exam" SET "startsAt" = now() - interval '2 hours', "endsAt" = now() + $2::interval WHERE id = $1`,
    [id, ended ? "-1 hour" : "1 hour"],
  );
}

async function insertAttempt(id: string) {
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", "deadlineAt", "rulesAcceptedAt", "maxScore")
     VALUES ($1, $2, $3, 1, now() + interval '30 minutes', now(), 5.25)`,
    [`exam-test-${id}`, id, candidate.id],
  );
}

before(async () => {
  await resetRateLimits();
  [owner, other, candidate] = [await createTempUser("EXAMINER"), await createTempUser("EXAMINER"), await createTempUser()];
  admin = await signInAs("admin");
  const topic = await owner.client.post("/topics", { name: "Number theory" });
  const otherTopic = await other.client.post("/topics", { name: "Number theory" });
  assert.equal(topic.status, 201, topic.text);
  assert.equal(otherTopic.status, 201, otherTopic.text);
  ownTopic = topic.body.data.id;
  easy = await makeQuestion(owner.client, ownTopic, "EASY");
  medium = await makeQuestion(owner.client, ownTopic, "MEDIUM");
  hard = await makeQuestion(owner.client, ownTopic, "HARD");
  foreign = await makeQuestion(other.client, otherTopic.body.data.id, "EASY");
});

beforeEach(resetRateLimits);
after(async () => {
  try {
    await sql('DELETE FROM "Attempt" WHERE id LIKE $1', ["exam-test-%"]);
    await sql('DELETE FROM "AuditLog" WHERE "entityType" = $1 AND "actorId" = $2', ["Exam", owner?.id ?? ""]);
    await removeTempUsers();
  } finally {
    await closeDatabase();
  }
});

describe("exam ownership and validation", () => {
  const endpoints = (id: string): [string, string, unknown?][] => [
    ["GET", "/exams"],
    ["POST", "/exams", futureExam()],
    ["GET", examPath(id)],
    ["PATCH", examPath(id), { title: "Revised" }],
    ["PUT", `${examPath(id)}/questions`, { questions: [] }],
    ["PUT", `${examPath(id)}/difficulty-rules`, {
      questionCount: 1,
      rules: ["EASY", "MEDIUM", "HARD"].map((difficulty) => ({ difficulty, percent: 0, marksEach: 1 })),
    }],
    ["GET", `${examPath(id)}/review`],
    ["POST", `${examPath(id)}/publish`],
    ["POST", `${examPath(id)}/unpublish`],
    ["POST", `${examPath(id)}/complete`],
    ["POST", `${examPath(id)}/join-code`],
    ["DELETE", `${examPath(id)}/join-code`],
  ];

  it("requires the examiner role for all operations and returns 404 for another examiner's record", async () => {
    const id = await makeExam();
    const guest = new Client();
    for (const [method, path, json] of endpoints(id)) {
      assert.equal((await guest.request(method, path, { json })).status, 401, `${method} ${path}`);
      assert.equal((await admin.request(method, path, { json })).status, 403, `${method} ${path}`);
      assert.equal((await candidate.client.request(method, path, { json })).status, 403, `${method} ${path}`);
      if (path.includes(id)) {
        assert.equal((await other.client.request(method, path, { json })).status, 404, `${method} ${path}`);
      }
    }
    const list = await other.client.get("/exams");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body, { data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it("returns only the examiner's summaries and does not list join codes or paper content", async () => {
    const id = await makeExam();
    await owner.client.post(`${examPath(id)}/join-code`);
    const res = await owner.client.get("/exams?state=DRAFT&pageSize=100");
    assert.equal(res.status, 200, res.text);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const data = res.body.data.find((row: { id: string }) => row.id === id);
    assert.deepEqual(Object.keys(data).sort(), [
      "id", "title", "status", "state", "startsAt", "endsAt", "durationMinutes", "totalMarks",
      "selectionMode", "createdAt", "updatedAt",
    ].sort());
    assert.equal(data.state, "DRAFT");
  });

  it("refuses invalid slots, extra fields, fractions and malformed input before writing", async () => {
    for (const invalid of [
      { title: " " }, { title: "x".repeat(201) }, { startsAt: futureExam().endsAt },
      { durationMinutes: 61 }, { durationMinutes: 1.5 }, { durationMinutes: "60" }, { totalMarks: 1.235 },
      { totalMarks: 100000 }, { maxAttempts: 0 }, { disputeWindowHours: -1 },
      { startsAt: "tomorrow" }, { ownerId: other.id }, { status: "PUBLISHED" },
    ]) {
      const response = await owner.client.post("/exams", { ...futureExam(), ...invalid });
      assert.equal(response.status, 422, JSON.stringify(invalid));
    }
    const id = await makeExam({ title: "O'Brien_% <exam>" });
    assert.equal((await owner.client.get(examPath(id))).body.data.title, "O'Brien_% <exam>");
    assert.equal((await owner.client.patch(examPath(id), {})).status, 422);
    assert.equal((await owner.client.patch(examPath(id), { durationMinutes: 75 })).status, 422);
    assert.equal((await owner.client.get("/exams?state=INVALID")).status, 422);
    assert.equal((await owner.client.get("/exams?pageSize=101")).status, 422);
    assert.equal((await owner.client.get("/exams?page=%00")).status, 400);
    assert.equal((await owner.client.get("/exams/%00")).status, 404);
    assert.equal((await owner.client.post("/exams", { ...futureExam(), title: "bad\u0000title" })).status, 400);
    assert.equal((await owner.client.post("/exams", { ...futureExam(), instructions: "x".repeat(66_000) })).status, 413);
    assert.equal((await owner.client.post("/exams", futureExam(), { headers: { Origin: "https://bad.example" } })).status, 403);
  });
});

describe("papers and publication", () => {
  it("preserves the stored pool if a replacement contains duplicate, foreign or archived questions", async () => {
    const id = await makeExam();
    const archived = await makeQuestion(owner.client, ownTopic, "HARD");
    assert.equal((await owner.client.patch(`/questions/${archived}`, { isArchived: true })).status, 200);
    for (const rows of [
      [{ questionId: easy }, { questionId: medium, marks: 3 }],
      [{ questionId: easy, marks: 1 }, { questionId: easy, marks: 2 }],
      [{ questionId: foreign, marks: 1 }, { questionId: archived, marks: 2 }],
    ]) {
      assert.equal((await pool(id, rows)).status, 422);
    }
    const result = await pool(id, [{ questionId: hard, marks: 2.25 }, { questionId: easy, marks: 3 }]);
    assert.equal(result.status, 200, result.text);
    assert.deepEqual(result.body.data.questions, [
      { questionId: hard, marks: 2.25, position: 1, question: { difficulty: "HARD", isArchived: false } },
      { questionId: easy, marks: 3, position: 2, question: { difficulty: "EASY", isArchived: false } },
    ]);
    assert.equal((await pool(id, [{ questionId: foreign, marks: 1 }])).status, 422);
    assert.deepEqual((await owner.client.get(examPath(id))).body.data.questions, result.body.data.questions);
  });

  it("reports every independent fixed-paper publish failure and accepts exact decimal totals", async () => {
    const overdue = await makeExam();
    await moveSlot(overdue, true);
    const review = await owner.client.get(`${examPath(overdue)}/review`);
    assert.equal(review.status, 200, review.text);
    assert.deepEqual(review.body.data.errors.map(({ path }: { path: string }) => path), ["startsAt", "questions", "totalMarks"]);
    const publish = await owner.client.post(`${examPath(overdue)}/publish`);
    assert.equal(publish.status, 422, publish.text);
    assert.deepEqual(publish.body.error.details, review.body.data.errors);

    const id = await makeExam({ totalMarks: 0.3 });
    await pool(id, [{ questionId: easy, marks: 0.1 }, { questionId: medium, marks: 0.2 }]);
    const result = await owner.client.post(`${examPath(id)}/publish`);
    assert.equal(result.status, 200, result.text);
    assert.equal(result.body.data.totalMarks, 0.3);
    assert.equal(result.body.data.state, "PUBLISHED");
    assert.equal((await pool(id, [])).status, 422);
    assert.equal((await owner.client.get(examPath(id))).body.data.questions.length, 2);
  });

  it("clears incompatible settings when switching modes and requires fresh fixed marks", async () => {
    const id = await makeExam();
    assert.equal((await pool(id, [{ questionId: easy, marks: 5.25 }])).status, 200);
    const balanced = await owner.client.patch(examPath(id), { selectionMode: "BALANCED" });
    assert.equal(balanced.status, 200, balanced.text);
    assert.equal(balanced.body.data.questions[0].marks, null);
    const rules = [
      { difficulty: "EASY", percent: 100, marksEach: 5.25 },
      { difficulty: "MEDIUM", percent: 0, marksEach: 1 },
      { difficulty: "HARD", percent: 0, marksEach: 1 },
    ];
    assert.equal((await put(id, "difficulty-rules", { questionCount: 1, rules })).status, 200);
    const fixed = await owner.client.patch(examPath(id), { selectionMode: "FIXED" });
    assert.equal(fixed.status, 200, fixed.text);
    assert.equal(fixed.body.data.questionCount, null);
    assert.deepEqual(fixed.body.data.difficultyRules, []);
    const result = await owner.client.post(`${examPath(id)}/publish`);
    assert.equal(result.status, 422, result.text);
    assert.equal(result.body.error.details[0].path, "questions.marks");
  });

  it("rejects a question archived after it entered a draft pool", async () => {
    const id = await makeExam();
    const archived = await makeQuestion(owner.client, ownTopic, "EASY");
    assert.equal((await pool(id, [{ questionId: archived, marks: 5.25 }])).status, 200);
    assert.equal((await owner.client.delete(`/questions/${archived}`)).body.data.outcome, "ARCHIVED");
    const result = await owner.client.post(`${examPath(id)}/publish`);
    assert.equal(result.status, 422, result.text);
    assert.match(result.body.error.details[0].message, /archived/);
  });

  it("reports balanced settings, per-level shortages, rounding, marks and small-pool warnings", async () => {
    const id = await makeExam({ selectionMode: "BALANCED", totalMarks: 9 });
    const before = await owner.client.get(`${examPath(id)}/review`);
    assert.deepEqual(before.body.data.errors.map(({ path }: { path: string }) => path), ["questionCount", "difficultyRules"]);
    assert.equal((await pool(id, [{ questionId: easy, marks: 1 }])).status, 422);
    assert.equal((await pool(id, [{ questionId: easy }, { questionId: medium }, { questionId: hard }])).status, 200);

    const rules = [
      { difficulty: "EASY", percent: 33, marksEach: 1.5 },
      { difficulty: "MEDIUM", percent: 33, marksEach: 3 },
      { difficulty: "HARD", percent: 34, marksEach: 4.5 },
    ];
    assert.equal((await put(id, "difficulty-rules", { questionCount: 3, rules: [rules[0], rules[0], rules[2]] })).status, 422);
    assert.equal((await put(id, "difficulty-rules", { questionCount: 3, rules: [{ ...rules[0], percent: 30 }, ...rules.slice(1)] })).status, 200);
    assert.equal((await owner.client.post(`${examPath(id)}/publish`)).body.error.details[0].path, "difficultyRules");
    assert.equal((await put(id, "difficulty-rules", { questionCount: 7, rules })).status, 200);

    const broken = await owner.client.post(`${examPath(id)}/publish`);
    assert.equal(broken.status, 422, broken.text);
    assert.deepEqual(broken.body.error.details.map(({ path }: { path: string }) => path), ["questions.EASY", "questions.MEDIUM", "questions.HARD", "totalMarks"]);

    assert.equal((await put(id, "difficulty-rules", { questionCount: 3, rules })).status, 200);
    const review = (await owner.client.get(`${examPath(id)}/review`)).body.data;
    assert.equal(review.canPublish, true);
    assert.equal(review.paperMarks, 9);
    assert.deepEqual(review.difficulty.map(({ required }: { required: number }) => required), [1, 1, 1]);
    assert.equal(review.warnings.length, 3);
    assert.equal((await owner.client.post(`${examPath(id)}/publish`)).status, 200);
    await insertAttempt(id);
    assert.equal((await put(id, "difficulty-rules", { questionCount: 1, rules })).status, 409);
  });
});

describe("exam lifecycle and join codes", () => {
  it("serializes racing publishes and records each successful transition once", async () => {
    const id = await makeExam();
    const path = examPath(id);
    await pool(id, [{ questionId: easy, marks: 5.25 }]);
    const outcomes = await Promise.all([owner.client.post(`${path}/publish`), owner.client.post(`${path}/publish`)]);
    assert.deepEqual(outcomes.map(({ status }) => status).sort(), [200, 409]);
    assert.equal((await owner.client.post(`${path}/unpublish`)).body.data.status, "DRAFT");
    assert.equal((await owner.client.get(path)).body.data.publishedAt, null);
    assert.equal((await owner.client.post(`${path}/unpublish`)).status, 409);
    assert.equal((await owner.client.post(`${path}/publish`)).status, 200);
    assert.equal((await owner.client.post(`${path}/complete`)).body.data.status, "COMPLETED");
    assert.equal((await owner.client.post(`${path}/complete`)).status, 409);
    assert.deepEqual(await sql(
      'SELECT action, count(*)::int AS count FROM "AuditLog" WHERE "entityId" = $1 AND "actorId" = $2 GROUP BY action ORDER BY action',
      [id, owner.id],
    ), [
      { action: "EXAM_COMPLETED", count: 1 },
      { action: "EXAM_PUBLISHED", count: 2 },
      { action: "EXAM_UNPUBLISHED", count: 1 },
    ]);
  });

  it("derives ongoing and completed states without writing them back", async () => {
    const id = await publishFixed();
    const path = examPath(id);
    await moveSlot(id);
    assert.equal((await owner.client.get(path)).body.data.state, "ONGOING");
    assert.equal((await owner.client.post(`${path}/unpublish`)).status, 409);
    const ongoing = await owner.client.get("/exams?state=ONGOING");
    assert.ok(ongoing.body.data.some((exam: { id: string }) => exam.id === id));
    await moveSlot(id, true);
    const detail = (await owner.client.get(path)).body.data;
    assert.equal(detail.status, "PUBLISHED");
    assert.equal(detail.state, "COMPLETED");
    const completed = await owner.client.get("/exams?state=COMPLETED");
    assert.ok(completed.body.data.some((exam: { id: string }) => exam.id === id));
  });

  it("locks paper settings after an attempt while preserving editable policies and the deadline", async () => {
    const id = await publishFixed();
    const path = examPath(id);
    await insertAttempt(id);
    for (const input of [{
      startsAt: new Date(Date.now() + 45 * 60_000).toISOString(),
    }, { durationMinutes: 45 }, { totalMarks: 10 }, { selectionMode: "BALANCED" }, { shuffleOptions: true }]) {
      assert.equal((await owner.client.patch(path, input)).status, 409);
    }
    assert.equal((await pool(id, [{ questionId: hard, marks: 5.25 }])).status, 409);
    assert.equal((await owner.client.post(`${path}/unpublish`)).status, 409);
    assert.equal((await owner.client.post(`${path}/complete`)).status, 409);
    const changes = { instructions: "Show your work.", maxAttempts: null, resultPolicy: "LATEST", disputeWindowHours: null, revealAnswers: true };
    const patched = await owner.client.patch(path, changes);
    assert.equal(patched.status, 200, patched.text);
    for (const [key, value] of Object.entries(changes)) assert.equal(patched.body.data[key], value);

    await sql('UPDATE "Attempt" SET "deadlineAt" = now() - interval \'1 second\' WHERE "examId" = $1', [id]);
    const deadline = await scalar<Date>('SELECT "deadlineAt" FROM "Attempt" WHERE "examId" = $1', [id]);
    assert.equal((await owner.client.post(`${path}/complete`)).status, 200);
    assert.deepEqual(await scalar<Date>('SELECT "deadlineAt" FROM "Attempt" WHERE "examId" = $1', [id]), deadline);
  });

  it("rotates codes, keeps them examiner-only, and safely disables an already disabled code", async () => {
    const id = await makeExam();
    const path = `${examPath(id)}/join-code`;
    assert.equal((await owner.client.get(examPath(id))).body.data.joinCode, null);
    const first = await owner.client.post(path);
    const second = await owner.client.post(path);
    assert.equal(first.status, 200, first.text);
    assert.equal(second.status, 200, second.text);
    const code = second.body.data.joinCode;
    assert.match(first.body.data.joinCode, /^[0-9a-f]{32}$/);
    assert.match(code, /^[0-9a-f]{32}$/);
    assert.notEqual(first.body.data.joinCode, code);
    assert.equal(await scalar('SELECT "joinCode" FROM "Exam" WHERE id = $1', [id]), code);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await owner.client.delete(path);
      assert.equal(response.status, 204);
      assert.equal(response.text, "");
    }
    assert.equal(await scalar('SELECT "joinCode" FROM "Exam" WHERE id = $1', [id]), null);
  });
});
