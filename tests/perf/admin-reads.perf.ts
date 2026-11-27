// Measures how long the administrator's read endpoints take when the tables
// are large, and fails if any of them exceeds its budget. Run with
// `npm run test:perf`. Not part of CI: timings depend on the machine.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Client, closeDatabase, resetRateLimits, signInAs, sql } from "../e2e/helpers";

const USERS = 50_000;
const AUDIT_ENTRIES = 300_000;
const SAMPLES = 40;

let admin: Client;
const results: { name: string; median: number; p95: number; budget: number }[] = [];

async function measure(name: string, path: string, budgetMs: number): Promise<void> {
  for (let warmUp = 0; warmUp < 5; warmUp++) await admin.get(path);
  const times: number[] = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    const response = await admin.get(path);
    times.push(performance.now() - started);
    assert.equal(response.status, 200, `${name}: ${response.text.slice(0, 200)}`);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  results.push({ name, median, p95, budget: budgetMs });
  assert.ok(p95 <= budgetMs, `${name}: p95 ${p95.toFixed(1)} ms is over the ${budgetMs} ms budget`);
}

before(async () => {
  await resetRateLimits();
  await sql(`DELETE FROM "AuditLog" WHERE id LIKE 'e2e-perf-%'`);
  await sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-%'`);

  await sql(
    `INSERT INTO "User" (id, email, name, "passwordHash", role, "isActive", "createdAt", "updatedAt")
     SELECT 'e2e-perf-u-' || n,
            'e2e-perf-' || n || '@exam.test',
            'Perf User ' || n,
            'not-a-real-hash',
            (CASE WHEN n % 50 = 0 THEN 'EXAMINER' ELSE 'CANDIDATE' END)::"Role",
            n % 40 <> 0,
            now() - (n || ' minutes')::interval,
            now()
     FROM generate_series(1, $1::int) AS n`,
    [USERS],
  );
  await sql(
    `INSERT INTO "AuditLog" (id, "actorId", action, "entityType", "entityId", metadata, ip, "createdAt")
     SELECT 'e2e-perf-a-' || n,
            CASE WHEN n % 5 = 0 THEN NULL ELSE 'e2e-perf-u-' || (1 + n % $2::int) END,
            (ARRAY['LOGIN_SUCCEEDED','LOGIN_SUCCEEDED','LOGIN_SUCCEEDED','LOGIN_FAILED','LOGOUT','USER_UPDATED'])[1 + n % 6],
            'User',
            'e2e-perf-u-' || (1 + n % $2::int),
            '{"source":"perf"}'::jsonb,
            '10.0.0.' || (n % 250),
            now() - (n * 5 || ' seconds')::interval
     FROM generate_series(1, $1::int) AS n`,
    [AUDIT_ENTRIES, USERS],
  );
  await sql('ANALYZE "User"');
  await sql('ANALYZE "AuditLog"');
  admin = await signInAs("admin");
});

after(async () => {
  await sql(`DELETE FROM "AuditLog" WHERE id LIKE 'e2e-perf-%'`);
  await sql(`DELETE FROM "User" WHERE id LIKE 'e2e-perf-%'`);
  await resetRateLimits();
  await closeDatabase();

  const width = Math.max(...results.map((row) => row.name.length));
  console.log(`\n${"Read".padEnd(width)}  median    p95  budget (ms)`);
  for (const row of results) {
    console.log(
      `${row.name.padEnd(width)}  ${row.median.toFixed(1).padStart(6)} ${row.p95.toFixed(1).padStart(6)}  ${String(row.budget).padStart(6)}`,
    );
  }
  console.log(`\nVolume: ${USERS.toLocaleString("en")} users, ${AUDIT_ENTRIES.toLocaleString("en")} audit entries; ${SAMPLES} samples each.`);
});

describe(`read times with ${USERS.toLocaleString("en")} users and ${AUDIT_ENTRIES.toLocaleString("en")} audit entries`, () => {
  it("current user (runs on every request)", () => measure("GET /auth/me", "/auth/me", 20));

  it("user list, first page", () => measure("GET /users", "/users", 25));
  it("user list, filtered by role", () => measure("GET /users?role=EXAMINER", "/users?role=EXAMINER", 25));
  it("user list, deep page", () => measure("GET /users?page=2000", "/users?page=2000", 30));
  it("user search by name", () => measure("GET /users?q=user 4321", "/users?q=user%204321", 80));
  it("user search by email", () => measure("GET /users?q=perf-777@", "/users?q=perf-777%40", 80));
  it("one user", () => measure("GET /users/{id}", "/users/e2e-perf-u-25000", 20));

  it("platform overview", () => measure("GET /admin/overview", "/admin/overview", 30));

  it("audit log, first page", () => measure("GET /admin/audit-logs", "/admin/audit-logs", 15));
  it("audit log, first page with a total", () =>
    measure("GET /admin/audit-logs?withTotal", "/admin/audit-logs?withTotal=true", 60));
  it("audit log, far into the log by cursor", () => {
    // Position about 200,000 entries deep: the cost must not depend on depth.
    const position = [new Date(Date.now() - 200_000 * 5_000).toISOString(), "zzzz"];
    const cursor = Buffer.from(JSON.stringify(position)).toString("base64url");
    return measure("GET /admin/audit-logs?cursor (deep)", `/admin/audit-logs?cursor=${cursor}`, 15);
  });
  it("audit log, by action", () => measure("GET /admin/audit-logs?action", "/admin/audit-logs?action=LOGIN_FAILED", 15));
  it("audit log, by actor", () => measure("GET /admin/audit-logs?actorId", "/admin/audit-logs?actorId=e2e-perf-u-123", 15));
  it("audit log, by record", () =>
    measure("GET /admin/audit-logs?entityId", "/admin/audit-logs?entityType=User&entityId=e2e-perf-u-123", 15));
  it("audit log, by time range", () =>
    measure(
      "GET /admin/audit-logs?from&to",
      `/admin/audit-logs?from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date().toISOString())}`,
      15,
    ));
});
