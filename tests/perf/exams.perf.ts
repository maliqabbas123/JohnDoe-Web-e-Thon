import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { type Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const OWN_EXAMS = 2_000;
const OTHER_EXAMINERS = 300;
const EXAMS_PER_EXAMINER = 100;
const POOL_SIZE = 500;
const SAMPLES = 40;
const LARGE_EXAM = "perf-exams-own-1";
let examiner: Client;

async function clearFixtures() {
  await sql('DELETE FROM "Exam" WHERE id LIKE $1', ["perf-exams-%"]);
  await sql('DELETE FROM "Question" WHERE id LIKE $1', ["perf-exams-%"]);
  await sql('DELETE FROM "Topic" WHERE id = $1', ["perf-exams-topic"]);
  await sql('DELETE FROM "User" WHERE id LIKE $1', ["perf-exams-owner-%"]);
}

before(async () => {
  await resetRateLimits();
  await clearFixtures();
  const [{ id: ownerId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT 'perf-exams-owner-' || n, 'perf-exams-owner-' || n || '@exam.test', 'Perf examiner ' || n,
            'unused', 'EXAMINER', now()
     FROM generate_series(1, $1::int) AS n`,
    [OTHER_EXAMINERS],
  );
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, "startsAt", "endsAt", "durationMinutes", "totalMarks", status, "createdAt", "updatedAt")
     SELECT 'perf-exams-other-' || examiner || '-' || exam, 'perf-exams-owner-' || examiner, 'Other exam ' || exam,
            now() + interval '1 hour', now() + interval '2 hours', 50, 90, 'PUBLISHED', now(), now()
     FROM generate_series(1, $1::int) AS examiner, generate_series(1, $2::int) AS exam`,
    [OTHER_EXAMINERS, EXAMS_PER_EXAMINER],
  );
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, "startsAt", "endsAt", "durationMinutes", "totalMarks", status,
                       "selectionMode", "questionCount", "createdAt", "updatedAt")
     SELECT 'perf-exams-own-' || n, $1, 'Own exam ' || n, now() + interval '1 hour', now() + interval '2 hours', 50, 90,
            (CASE WHEN n % 2 = 0 THEN 'PUBLISHED' ELSE 'DRAFT' END)::"ExamStatus",
            (CASE WHEN n = 1 THEN 'BALANCED' ELSE 'FIXED' END)::"SelectionMode",
            CASE WHEN n = 1 THEN 60 END, now() - n * interval '1 minute', now()
     FROM generate_series(1, $2::int) AS n`,
    [ownerId, OWN_EXAMS],
  );
  await sql('INSERT INTO "Topic" (id, "ownerId", name) VALUES ($1, $2, $3)', ["perf-exams-topic", ownerId, "Performance questions"]);
  await sql(
    `INSERT INTO "Question" (id, "ownerId", "topicId", type, difficulty, text, "defaultMarks", "updatedAt")
     SELECT 'perf-exams-question-' || n, $1, 'perf-exams-topic', 'WRITTEN',
            (ARRAY['EASY','MEDIUM','HARD'])[1 + n % 3]::"Difficulty", 'Question ' || n, 1.50, now()
     FROM generate_series(1, $2::int) AS n`,
    [ownerId, POOL_SIZE],
  );
  await sql(
    `INSERT INTO "ExamQuestion" (id, "examId", "questionId", position)
     SELECT 'perf-exams-pool-' || n, $1, 'perf-exams-question-' || n, n FROM generate_series(1, $2::int) AS n`,
    [LARGE_EXAM, POOL_SIZE],
  );
  await sql(
    `INSERT INTO "ExamDifficultyRule" (id, "examId", difficulty, percent, "marksEach") VALUES
     ('perf-exams-rule-easy', $1, 'EASY', 25, 1.50),
     ('perf-exams-rule-medium', $1, 'MEDIUM', 50, 1.50),
     ('perf-exams-rule-hard', $1, 'HARD', 25, 1.50)`,
    [LARGE_EXAM],
  );
  await sql('ANALYZE "Exam", "ExamQuestion", "ExamDifficultyRule", "Question"');
  examiner = await signInAs("examiner");
});

after(async () => {
  try {
    await clearFixtures();
  } finally {
    await closeDatabase();
  }
});

async function measure(path: string, budgetMs: number) {
  const samples: number[] = [];
  for (let run = 0; run < SAMPLES + 5; run++) {
    const start = performance.now();
    const response = await examiner.get(path);
    const duration = performance.now() - start;
    assert.equal(response.status, 200, response.text.slice(0, 200));
    if (run >= 5) samples.push(duration);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(`${path}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, budget ${budgetMs} ms`);
  assert.ok(p95 <= budgetMs, `${path}: p95 ${p95.toFixed(1)} ms exceeds the ${budgetMs} ms budget`);
}

describe("exam read times at volume", () => {
  it("lists exams with page counts across 32,000 exams", () => measure("/exams", 50));
  it("lists upcoming published exams on a deep page", () => measure("/exams?state=PUBLISHED&page=10&pageSize=100", 70));
  it("reads settings and the entire 500-question pool", () => measure(`/exams/${LARGE_EXAM}`, 80));
  it("reviews a 60-question balanced paper against the entire pool", () => measure(`/exams/${LARGE_EXAM}/review`, 70));
});
