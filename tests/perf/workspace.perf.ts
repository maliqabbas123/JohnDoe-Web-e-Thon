import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import { closeDatabase, createTempUser, resetRateLimits, sql, type TempUser } from "../e2e/helpers";

const OTHER_CANDIDATES = 20_000;
const SAMPLES = 40;
const BUDGET_MS = 20;
const workspace = { theme: "dark", fontSize: 24, lineSpacing: 1.75, palettePosition: "left" };

let candidate: TempUser;

async function cleanup() {
  await sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-workspace-%'`);
  if (candidate) await sql('DELETE FROM "User" WHERE id = $1', [candidate.id]);
}

before(async () => {
  await resetRateLimits();
  await cleanup();
  candidate = await createTempUser("CANDIDATE");
  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "updatedAt")
     SELECT 'e2e-perf-workspace-' || n, 'e2e-perf-workspace-' || n || '@exam.test',
            'Perf Candidate ' || n, 'not-a-real-hash', 'CANDIDATE', now()
     FROM generate_series(1, $1::int) AS n`,
    [OTHER_CANDIDATES],
  );
  await sql(
    `INSERT INTO "UserPreference" ("userId", workspace, "updatedAt")
     SELECT id, $1::jsonb, now() FROM "User" WHERE id LIKE 'e2e-perf-workspace-%' OR id = $2`,
    [JSON.stringify(workspace), candidate.id],
  );
  await sql('ANALYZE "UserPreference"');
});

after(async () => {
  await cleanup();
  await resetRateLimits();
  await closeDatabase();
});

it("reads the candidate's workspace at volume", async () => {
  const path = "/me/preferences";
  for (let warmUp = 0; warmUp < 5; warmUp++) {
    const response = await candidate.client.get(path);
    assert.equal(response.status, 200, response.text);
  }
  const samples: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const start = performance.now();
    const response = await candidate.client.get(path);
    samples.push(performance.now() - start);
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body, { data: workspace });
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.floor(samples.length * 0.95)];
  console.log("GET /me/preferences — median " + median.toFixed(1) + " ms, p95 " + p95.toFixed(1) + " ms");
  assert.ok(p95 <= BUDGET_MS, "GET /me/preferences p95 exceeds the " + BUDGET_MS + " ms budget");
});
