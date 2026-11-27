import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { Client, TEST_ACCOUNTS, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const OTHER_EXAMINERS = 200;
const JOBS_PER_EXAMINER = 100;
const OWN_JOBS = 500;
const SAMPLES = 40;
const BUDGET_MS = 30;

let examiner: Client;
let laterPage: string;

async function cleanup() {
  await sql(`DELETE FROM "ImportJob" WHERE id LIKE 'e2e-perf-import-%'`);
  await sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-import-%'`);
}

before(async () => {
  await resetRateLimits();
  await cleanup();
  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT 'e2e-perf-import-' || n, 'e2e-perf-import-' || n || '@exam.test',
            'Perf Examiner ' || n, 'not-a-real-hash', 'EXAMINER', now()
     FROM generate_series(1, $1::int) AS n`,
    [OTHER_EXAMINERS],
  );
  await sql(
    `INSERT INTO "ImportJob" (id, "userId", kind, "fileName", "totalRows", "successCount", "failureCount", errors, "createdAt")
     SELECT 'e2e-perf-import-job-' || u.id || '-' || job.n, u.id, 'QUESTIONS',
            'questions-' || job.n || '.csv', 100, 99, 1,
            '[{"row":11,"field":"difficulty","message":"Label the question easy, medium or hard."}]'::jsonb,
            now() - job.n * interval '1 hour'
     FROM "User" u
     CROSS JOIN LATERAL generate_series(1, CASE WHEN u.email = $1 THEN $2::int ELSE $3::int END) AS job(n)
     WHERE u.email = $1 OR u.id LIKE 'e2e-perf-import-%'`,
    [TEST_ACCOUNTS.examiner.email, OWN_JOBS, JOBS_PER_EXAMINER],
  );
  await sql('ANALYZE "ImportJob"');

  examiner = await signInAs("examiner");
  laterPage = "/import/jobs?pageSize=50";
  for (let page = 0; page < 8; page++) {
    const response = await examiner.get(laterPage);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.length, 50);
    assert.ok(response.body.meta.nextCursor);
    laterPage = "/import/jobs?pageSize=50&cursor=" + response.body.meta.nextCursor;
  }
});

after(async () => {
  await cleanup();
  await resetRateLimits();
  await closeDatabase();
});

async function measure(path: string, label: string, pageSize: number) {
  for (let warmUp = 0; warmUp < 5; warmUp++) {
    const response = await examiner.get(path);
    assert.equal(response.status, 200, response.text);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const start = performance.now();
    const response = await examiner.get(path);
    samples.push(performance.now() - start);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.length, pageSize);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log(label + " — median " + median.toFixed(1) + " ms, p95 " + p95.toFixed(1) + " ms");
  assert.ok(p95 <= BUDGET_MS, label + ": p95 " + p95.toFixed(1) + " ms exceeds " + BUDGET_MS + " ms");
}

it("lists import history at volume, including a late cursor page", async () => {
  await measure("/import/jobs", "Import jobs, first page", 20);
  await measure(laterPage, "Import jobs, after 400 entries with pageSize=50", 50);
});
