// Read times for the question bank when the platform holds many examiners'
// questions and the signed-in examiner has a large bank of their own.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const OTHER_EXAMINERS = 300;
const QUESTIONS_EACH = 500;
const OWN_QUESTIONS = 2_000;
const SAMPLES = 40;

let examiner: Client;
let ownTopicId: string;
let ownQuestionId: string;
const results: { name: string; median: number; p95: number; budget: number }[] = [];

async function measure(name: string, path: string, budgetMs: number): Promise<void> {
  for (let warmUp = 0; warmUp < 5; warmUp++) await examiner.get(path);
  const times: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    const response = await examiner.get(path);
    times.push(performance.now() - started);
    assert.equal(response.status, 200, `${name}: ${response.text.slice(0, 200)}`);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  results.push({ name, median, p95, budget: budgetMs });
  assert.ok(p95 <= budgetMs, `${name}: p95 ${p95.toFixed(1)} ms is over the ${budgetMs} ms budget`);
}

async function removeData(): Promise<void> {
  await sql(`DELETE FROM "Question" WHERE id LIKE 'e2e-perf-%'`);
  await sql(`DELETE FROM "Topic" WHERE id LIKE 'e2e-perf-%'`);
  await sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-ex-%'`);
}

async function insertBank(ownerExpression: string, prefix: string, owners: number, perOwner: number): Promise<void> {
  // Ten topics per owner, questions spread across them, four options each.
  await sql(
    `INSERT INTO "Topic" (id, "ownerId", name)
     SELECT '${prefix}-t-' || o || '-' || t, ${ownerExpression}, 'Topic ' || t
     FROM generate_series(1, $1::int) AS o, generate_series(1, 10) AS t`,
    [owners],
  );
  await sql(
    `INSERT INTO "Question" (id, "ownerId", "topicId", type, difficulty, text, "defaultMarks", "createdAt", "updatedAt")
     SELECT '${prefix}-q-' || o || '-' || n,
            ${ownerExpression},
            '${prefix}-t-' || o || '-' || (1 + n % 10),
            (CASE WHEN n % 5 = 0 THEN 'WRITTEN' WHEN n % 5 = 1 THEN 'MULTIPLE_SELECT' ELSE 'SINGLE_CHOICE' END)::"QuestionType",
            (ARRAY['EASY','MEDIUM','HARD'])[1 + n % 3]::"Difficulty",
            'Perf question ' || n || ' about subject ' || (n % 97),
            2,
            now() - (n || ' minutes')::interval,
            now()
     FROM generate_series(1, $1::int) AS o, generate_series(1, $2::int) AS n`,
    [owners, perOwner],
  );
  await sql(
    `INSERT INTO "QuestionOption" (id, "questionId", text, "isCorrect", position)
     SELECT q.id || '-o' || p, q.id, 'Option ' || p, p = 1, p
     FROM "Question" q, generate_series(1, 4) AS p
     WHERE q.id LIKE '${prefix}-q-%' AND q.type <> 'WRITTEN'`,
  );
}

before(async () => {
  await resetRateLimits();
  await removeData();

  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT 'e2e-perf-ex-' || n, 'e2e-perf-ex-' || n || '@exam.test', 'Perf Examiner ' || n, 'not-a-real-hash', 'EXAMINER', now()
     FROM generate_series(1, $1::int) AS n`,
    [OTHER_EXAMINERS],
  );
  await insertBank(`'e2e-perf-ex-' || o`, "e2e-perf-other", OTHER_EXAMINERS, QUESTIONS_EACH);

  const [{ id: ownerId }] = await sql<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [TEST_ACCOUNTS.examiner.email]);
  await insertBank(`'${ownerId}'`, "e2e-perf-own", 1, OWN_QUESTIONS);
  ownTopicId = "e2e-perf-own-t-1-3";
  ownQuestionId = "e2e-perf-own-q-1-1000";

  for (const table of ["Topic", "Question", "QuestionOption"]) await sql(`ANALYZE "${table}"`);
  examiner = await signInAs("examiner");
});

after(async () => {
  await removeData();
  await resetRateLimits();
  await closeDatabase();

  const width = Math.max(...results.map((row) => row.name.length));
  console.log(`\n${"Read".padEnd(width)}  median    p95  budget (ms)`);
  for (const row of results) {
    console.log(
      `${row.name.padEnd(width)}  ${row.median.toFixed(1).padStart(6)} ${row.p95.toFixed(1).padStart(6)}  ${String(row.budget).padStart(6)}`,
    );
  }
  const total = OTHER_EXAMINERS * QUESTIONS_EACH + OWN_QUESTIONS;
  console.log(`\nVolume: ${total.toLocaleString("en")} questions across ${OTHER_EXAMINERS + 1} examiners; the signed-in examiner owns ${OWN_QUESTIONS.toLocaleString("en")}. ${SAMPLES} samples each.`);
});

describe("question bank read times at volume", () => {
  it("topics with counts", () => measure("GET /topics", "/topics", 25));
  it("question list, first page", () => measure("GET /questions", "/questions", 30));
  it("question list, largest page", () => measure("GET /questions?pageSize=100", "/questions?pageSize=100", 60));
  it("question list, last page", () => measure("GET /questions?page=100", "/questions?page=100", 30));
  it("question list, by topic and difficulty", () =>
    measure("GET /questions?topicId&difficulty", `/questions?topicId=${ownTopicId}&difficulty=HARD`, 25));
  it("question search", () => measure("GET /questions?q", "/questions?q=subject%2042", 30));
  it("one question", () => measure("GET /questions/{id}", `/questions/${ownQuestionId}`, 20));
});
