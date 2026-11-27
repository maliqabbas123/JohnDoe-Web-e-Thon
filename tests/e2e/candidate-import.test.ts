import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, it } from "node:test";
import { removeEvaluationExam, seedEvaluationExam } from "./evaluation-fixtures";
import { Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, signIn, signInAs, sql, tempEmail, type TempUser } from "./helpers";

let examiner: TempUser;
let outsider: TempUser;
let existing: TempUser;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
const path = () => "/import/candidates?examId=" + exam.id;

before(async () => {
  await resetRateLimits();
  examiner = await createTempUser("EXAMINER");
  outsider = await createTempUser("EXAMINER");
  existing = await createTempUser("CANDIDATE");
});
beforeEach(async () => {
  await resetRateLimits();
  exam = await seedEvaluationExam(examiner.id, 1);
});
afterEach(async () => {
  if (exam) await removeEvaluationExam(exam);
});
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

it("requires an owning examiner and ignores identity supplied by the caller", async () => {
  const rows = [{ email: tempEmail("forbidden"), name: "Candidate" }];
  for (const [client, status] of [
    [new Client(), 401], [existing.client, 403], [await signInAs("admin"), 403], [outsider.client, 404],
  ] as const) {
    assert.equal((await client.post(path(), rows)).status, status);
  }
  assert.equal((await examiner.client.post("/import/candidates", rows)).status, 422);
  assert.deepEqual(await sql('SELECT id FROM "User" WHERE email = $1', [rows[0].email]), []);
});

it("creates, enrols and audits valid rows and returns only new passwords once", async () => {
  const email = tempEmail("new");
  const rows = [
    { email: email.toUpperCase(), name: "  New Candidate  " },
    { email: existing.email, name: "Do not rename" },
    { email: "invalid", name: "Bad email" },
    { email, name: "Duplicate" },
    { email: outsider.email, name: "Wrong role" },
    { email: tempEmail("field"), name: "Extra field", role: "ADMIN" },
  ];
  const response = await examiner.client.post(path() + "&fileName=roster.json", rows);
  assert.equal(response.status, 201, response.text);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { job, initialCredentials } = response.body.data;
  assert.deepEqual({ kind: job.kind, examId: job.examId, file: job.fileName, total: job.totalRows, imported: job.successCount, rejected: job.failureCount }, {
    kind: "CANDIDATES", examId: exam.id, file: "roster.json", total: 6, imported: 2, rejected: 4,
  });
  assert.deepEqual(job.errors.map(({ row, field }: { row: number; field: string }) => [row, field]), [
    [3, "email"], [4, "email"], [5, "email"], [6, "row"],
  ]);
  assert.equal(initialCredentials.length, 1);
  const { row, password } = initialCredentials[0];
  assert.equal(row, 1);
  assert.equal(initialCredentials[0].email, email);
  assert.equal(typeof password, "string");
  assert.ok(password.length >= 18);

  const [user] = await sql<{ id: string; name: string; role: string; passwordHash: string }>(
    'SELECT id, name, role, "passwordHash" FROM "User" WHERE email = $1', [email],
  );
  assert.equal(user.name, "New Candidate");
  assert.equal(user.role, "CANDIDATE");
  assert.notEqual(user.passwordHash, password);
  const signedIn = await signIn(email, password);
  assert.equal((await signedIn.get("/auth/me")).body.data.role, "CANDIDATE");
  assert.equal((await signIn(existing.email, existing.password).then((client) => client.get("/auth/me"))).body.data.name, "Temp User");

  const enrolled = await sql<{ candidateId: string }>('SELECT "candidateId" FROM "Enrollment" WHERE "examId" = $1', [exam.id]);
  assert.deepEqual(new Set(enrolled.map(({ candidateId }) => candidateId)), new Set([user.id, existing.id]));
  const [audit] = await sql('SELECT "actorId", action, metadata FROM "AuditLog" WHERE "entityId" = $1 AND action = $2', [user.id, "USER_CREATED"]);
  assert.deepEqual(audit, { actorId: examiner.id, action: "USER_CREATED", metadata: { examId: exam.id, email, role: "CANDIDATE" } });

  const repeated = await examiner.client.post(path(), [rows[0]]);
  assert.equal(repeated.status, 201, repeated.text);
  assert.equal(repeated.body.data.job.successCount, 1);
  assert.deepEqual(repeated.body.data.initialCredentials, []);
  const history = await examiner.client.get("/import/jobs");
  assert.deepEqual(history.body.data.find((entry: { id: string }) => entry.id === job.id), job);
  assert.ok(!history.text.includes(password));
  assert.ok(!history.text.includes("initialCredentials"));
});

it("handles quoted CSV and generates one usable password when uploads race", async () => {
  const email = tempEmail("race");
  const rawBody = '\uFEFFemail,name\r\n' + email + ',"Surname, Given"\r\n';
  const upload = () => examiner.client.post(path(), undefined, { rawBody, headers: { "Content-Type": "text/csv" } });
  const results = await Promise.all([upload(), upload()]);
  for (const response of results) {
    assert.equal(response.status, 201, response.text);
    assert.equal(response.body.data.job.successCount, 1);
  }
  assert.deepEqual(results.map(({ body }) => body.data.initialCredentials.length).sort(), [0, 1]);
  const accounts = await sql('SELECT name FROM "User" WHERE email = $1', [email]);
  assert.deepEqual(accounts, [{ name: "Surname, Given" }]);
  assert.equal((await sql('SELECT id FROM "Enrollment" WHERE "examId" = $1', [exam.id])).length, 1);
});

it("checks the row limit and rate-limits repeated upload attempts", async () => {
  const rows = Array.from({ length: 51 }, () => ({ email: tempEmail("limit"), name: "Candidate" }));
  assert.equal((await examiner.client.post(path(), rows)).status, 413);
  assert.equal((await examiner.client.post(path(), [])).status, 400);
  assert.equal((await examiner.client.post(path(), {})).status, 400);
  const limited = await examiner.client.post(path(), rows.slice(0, 1));
  assert.equal(limited.status, 429, limited.text);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
