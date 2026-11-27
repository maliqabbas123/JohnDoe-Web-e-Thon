import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { removeEvaluationExam, seedEvaluationAttempt, seedEvaluationExam } from "../e2e/evaluation-fixtures";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const OTHER_ATTEMPTS = 499;
const QUESTIONS = 20;
const SAMPLES = 40;
let candidate: Client;
let examiner: Client;
let exam: Awaited<ReturnType<typeof seedEvaluationExam>>;
let attemptId: string;

async function removeCandidates() {
  await sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-monitor-%'`);
}

before(async () => {
  await resetRateLimits();
  await removeCandidates();
  const [owner] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  const [user] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.candidate.email]);
  exam = await seedEvaluationExam(owner.id, QUESTIONS);
  attemptId = await seedEvaluationAttempt(exam, user.id, { status: "IN_PROGRESS" });
  await sql(`
    INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
    SELECT 'e2e-perf-monitor-' || n, 'e2e-perf-monitor-' || n || '@exam.test',
           'Candidate ' || n, 'fixture', 'CANDIDATE', now()
    FROM generate_series(1, $1::int) n
  `, [OTHER_ATTEMPTS]);
  await sql(`
    INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", "startedAt", "deadlineAt", "rulesAcceptedAt", "lastSeenAt", "maxScore")
    SELECT id || '-attempt', $1, id, 1, now() - interval '5 minutes', now() + interval '25 minutes',
           now() - interval '5 minutes',
           CASE WHEN right(id, 1) = '1' THEN now() - interval '60 seconds' ELSE now() END, $2
    FROM "User" WHERE id LIKE 'e2e-perf-monitor-%'
  `, [exam.id, exam.totalMarks]);
  await sql(`
    INSERT INTO "AttemptQuestion" (id, "attemptId", "questionId", position, marks, snapshot, "optionOrder", "selectedOptionIds")
    SELECT a.id || '-q-' || q.position, a.id, q."questionId", q.position, q.marks, '{}', '{}', '{}'
    FROM "Attempt" a JOIN "ExamQuestion" q ON q."examId" = a."examId"
    WHERE a."examId" = $1 AND a.id LIKE 'e2e-perf-monitor-%'
  `, [exam.id]);
  await sql(`
    INSERT INTO "Incident" (id, "attemptId", type, source)
    SELECT id || '-signal', id, 'TAB_HIDDEN', 'CLIENT' FROM "Attempt" WHERE "examId" = $1
  `, [exam.id]);
  await sql(`
    INSERT INTO "Announcement" (id, "examId", "authorId", message, "createdAt")
    SELECT $1 || '-notice-' || n, $1, $2, 'Announcement ' || n, now() - (201 - n) * interval '1 second'
    FROM generate_series(1, 200) n
  `, [exam.id, owner.id]);
  for (const table of ["Attempt", "AttemptQuestion", "Incident", "Announcement"]) {
    await sql('ANALYZE "' + table + '"');
  }
  candidate = await signInAs("candidate");
  examiner = await signInAs("examiner");
});

after(async () => {
  if (exam) await removeEvaluationExam(exam);
  await removeCandidates();
  await resetRateLimits();
  await closeDatabase();
});

async function measure(label: string, budget: number, request: () => ReturnType<Client["get"]>) {
  for (let warmUp = 0; warmUp < 5; warmUp++) {
    const response = await request();
    assert.equal(response.status, 200, response.text);
  }
  const samples: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const start = performance.now();
    const response = await request();
    samples.push(performance.now() - start);
    assert.equal(response.status, 200, response.text);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(label + " — median " + median.toFixed(1) + " ms, p95 " + p95.toFixed(1) + " ms");
  assert.ok(p95 <= budget, label + " p95 exceeds its " + budget + " ms budget");
}

it("returns candidate contact and announcements with 500 active attempts", () =>
  measure("POST /attempts/{id}/heartbeat", 35, () => candidate.post("/attempts/" + attemptId + "/heartbeat")));

it("reads monitor pages with progress and signal counts for 500 attempts", () =>
  measure("GET /exams/{id}/monitor", 80, () => examiner.get("/exams/" + exam.id + "/monitor")));

it("pages announcement history", () =>
  measure("GET /exams/{id}/announcements", 30, () => examiner.get("/exams/" + exam.id + "/announcements")));
