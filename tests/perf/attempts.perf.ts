import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { type Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const ACTOR_ATTEMPT = "/attempts/perf-attempt-own";
let candidate: Client;

async function clearFixtures() {
  await sql('DELETE FROM "Attempt" WHERE id LIKE $1', ["perf-attempt-%"]);
  await sql('DELETE FROM "Exam" WHERE id = $1', ["perf-attempt-exam"]);
  await sql('DELETE FROM "Question" WHERE id LIKE $1', ["perf-attempt-%"]);
  await sql('DELETE FROM "Topic" WHERE id = $1', ["perf-attempt-topic"]);
  await sql('DELETE FROM "User" WHERE id LIKE $1', ["perf-attempt-%"]);
}

before(async () => {
  await resetRateLimits();
  await clearFixtures();
  const ids = await sql<{ id: string; email: string }>('SELECT id, email FROM "User" WHERE email IN ($1, $2)', [
    TEST_ACCOUNTS.examiner.email, TEST_ACCOUNTS.candidate.email,
  ]);
  const owner = ids.find(({ email }) => email === TEST_ACCOUNTS.examiner.email)!.id;
  const student = ids.find(({ email }) => email === TEST_ACCOUNTS.candidate.email)!.id;
  await sql('INSERT INTO "Topic" (id, "ownerId", name) VALUES ($1, $2, $3)', ["perf-attempt-topic", owner, "Performance"]);
  await sql(
    `INSERT INTO "Question" (id, "ownerId", "topicId", type, difficulty, text, "defaultMarks", "updatedAt")
     SELECT 'perf-attempt-question-' || n, $1, 'perf-attempt-topic', 'SINGLE_CHOICE', 'EASY', 'Question ' || n, 2, now()
     FROM generate_series(1, 20) AS n`, [owner],
  );
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, "startsAt", "endsAt", "durationMinutes", "totalMarks", status, "updatedAt")
     VALUES ('perf-attempt-exam', $1, 'Attempt load', now() - interval '5 minutes', now() + interval '1 hour',
             45, 40, 'PUBLISHED', now())`, [owner],
  );
  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT 'perf-attempt-user-' || n, 'perf-attempt-user-' || n || '@exam.test', 'Candidate ' || n,
            'unused', 'CANDIDATE', now()
     FROM generate_series(1, 600) AS n`,
  );
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", "rulesAcceptedAt", "deadlineAt", "maxScore")
     SELECT 'perf-attempt-' || n, 'perf-attempt-exam', 'perf-attempt-user-' || n, 1, now(), now() + interval '30 minutes', 40
     FROM generate_series(1, 600) AS n
     UNION ALL
     SELECT 'perf-attempt-own', 'perf-attempt-exam', $1, 1, now(), now() + interval '30 minutes', 40`, [student],
  );
  const paper = {
    version: 1, type: "SINGLE_CHOICE", difficulty: "EASY",
    topic: { id: "perf-attempt-topic", name: "Performance" },
    text: "Which option is correct?",
    options: [{ id: "correct-option", text: "One", isCorrect: true }, { id: "wrong-option", text: "Two", isCorrect: false }],
    multiSelectScoring: "ALL_OR_NOTHING",
  };
  await sql(
    `INSERT INTO "AttemptQuestion" (id, "attemptId", "questionId", position, marks, snapshot, "optionOrder", "selectedOptionIds")
     SELECT a.id || '-q-' || n, a.id, 'perf-attempt-question-' || n, n, 2, $1::jsonb,
            ARRAY['correct-option','wrong-option'], ARRAY[]::text[]
     FROM "Attempt" a CROSS JOIN generate_series(1, 20) AS n WHERE a."examId" = 'perf-attempt-exam'`,
    [JSON.stringify(paper)],
  );
  await sql('ANALYZE "Attempt", "AttemptQuestion"');
  candidate = await signInAs("candidate");
});

after(async () => {
  try {
    await clearFixtures();
  } finally {
    await closeDatabase();
  }
});

async function measure(label: string, operation: (sample: number) => ReturnType<Client["get"]>, budget: number) {
  const samples: number[] = [];
  for (let run = 0; run < 45; run++) {
    const started = performance.now();
    const response = await operation(run);
    const duration = performance.now() - started;
    assert.equal(response.status, 200, response.text.slice(0, 200));
    if (run >= 5) samples.push(duration);
  }
  samples.sort((a, b) => a - b);
  console.log(`${label}: median ${samples[20].toFixed(1)} ms, p95 ${samples[38].toFixed(1)} ms, budget ${budget} ms`);
  assert.ok(samples[38] <= budget, `${label} exceeded its read-time budget`);
}

it("reads attempt status with 601 attempts in progress", () => measure("Attempt status", () => candidate.get(ACTOR_ATTEMPT), 55));
it("delivers and navigates questions with 601 attempts in progress", () =>
  measure("Question delivery", (sample) => candidate.get(`${ACTOR_ATTEMPT}/questions/${sample % 2 + 1}`), 65));
it("saves fresh answer revisions with 601 attempts in progress", () =>
  measure("Answer save", (sample) => candidate.request("PUT", `${ACTOR_ATTEMPT}/answers/1`, {
    json: { revision: sample + 1, selectedOptionIds: ["correct-option"] },
  }), 65));
