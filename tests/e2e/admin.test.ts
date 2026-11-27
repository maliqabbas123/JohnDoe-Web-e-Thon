import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  Client,
  closeDatabase,
  createTempUser,
  removeTempUsers,
  resetRateLimits,
  scalar,
  signInAs,
  sql,
  tempEmail,
} from "./helpers";

let admin: Client;
let adminId: string;

const count = async (text: string, params: unknown[] = []) => Number(await scalar<string>(text, params));

before(async () => {
  await resetRateLimits();
  admin = await signInAs("admin");
  adminId = (await admin.get("/auth/me")).body.data.id;
});
beforeEach(resetRateLimits);
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

describe("administrator-only access", () => {
  const paths = ["/admin/overview", "/admin/audit-logs"];

  it("refuses callers without a session", async () => {
    for (const path of paths) assert.equal((await new Client().get(path)).status, 401, path);
  });

  for (const role of ["CANDIDATE", "EXAMINER"] as const) {
    it(`refuses a ${role.toLowerCase()}`, async () => {
      const user = await createTempUser(role);
      for (const path of paths) {
        const response = await user.client.get(path);
        assert.equal(response.status, 403, path);
        assert.equal(response.body.error.code, "FORBIDDEN");
      }
    });
  }

  it("stops serving an administrator who has been demoted", async () => {
    const created = await admin.post("/users", {
      email: tempEmail("shortlived-admin"),
      name: "Short Lived",
      role: "ADMIN",
      password: "temp-admin-pass-1",
    });
    const second = new Client();
    await second.post("/auth/login", { email: created.body.data.email, password: "temp-admin-pass-1" });
    assert.equal((await second.get("/admin/overview")).status, 200);

    await admin.patch(`/users/${created.body.data.id}`, { role: "CANDIDATE" });
    assert.equal((await second.get("/admin/overview")).status, 401, "the old session is ended");
  });
});

describe("platform overview", () => {
  it("matches the database", async () => {
    await createTempUser("EXAMINER");
    await new Client().post("/auth/login", { email: tempEmail("fail"), password: "wrong" });

    const response = await admin.get("/admin/overview");
    assert.equal(response.status, 200);
    const { users, sessions, security, exams, attempts, disputes } = response.body.data;

    assert.equal(users.total, await count('SELECT count(*) FROM "User"'));
    assert.equal(users.administrators, await count(`SELECT count(*) FROM "User" WHERE role = 'ADMIN'`));
    assert.equal(users.examiners, await count(`SELECT count(*) FROM "User" WHERE role = 'EXAMINER'`));
    assert.equal(users.candidates, await count(`SELECT count(*) FROM "User" WHERE role = 'CANDIDATE'`));
    assert.equal(users.inactive, await count('SELECT count(*) FROM "User" WHERE NOT "isActive"'));
    assert.equal(users.active + users.inactive, users.total);
    assert.equal(users.administrators + users.examiners + users.candidates, users.total);

    assert.equal(
      sessions.active,
      await count('SELECT count(*) FROM "Session" WHERE "revokedAt" IS NULL AND "expiresAt" > now()'),
    );
    assert.equal(
      security.failedSignInsLast24Hours,
      await count(`SELECT count(*) FROM "AuditLog" WHERE action = 'LOGIN_FAILED' AND "createdAt" >= now() - interval '24 hours'`),
    );
    assert.ok(security.failedSignInsLast24Hours >= 1);

    assert.deepEqual(Object.keys(exams).sort(), ["completed", "draft", "ongoing", "published", "upcoming"]);
    assert.deepEqual(Object.keys(attempts).sort(), ["expired", "inProgress", "interrupted", "submitted"]);
    assert.equal(disputes.open, await count(`SELECT count(*) FROM "Dispute" WHERE status = 'OPEN'`));
  });

  it("counts only failed sign-ins from the last 24 hours", async () => {
    const before = (await admin.get("/admin/overview")).body.data.security.failedSignInsLast24Hours;
    await sql(
      `INSERT INTO "AuditLog" (id, action, "entityType", "createdAt") VALUES ($1, 'LOGIN_FAILED', 'User', now() - interval '25 hours')`,
      [`e2e-old-${Date.now()}`],
    );
    const after = (await admin.get("/admin/overview")).body.data.security.failedSignInsLast24Hours;
    assert.equal(after, before);
    await sql(`DELETE FROM "AuditLog" WHERE id LIKE 'e2e-old-%'`);
  });

  it("contains counts only: no names, emails or exam content", async () => {
    const response = await admin.get("/admin/overview");
    assert.doesNotMatch(response.text, /@exam\.test|passwordHash|scrypt/);
    const numbers = JSON.stringify(response.body.data, (key, value) => (key === "serverTime" ? undefined : value));
    assert.match(numbers, /^[{}":,a-zA-Z0-9]+$/, "every value besides the server time is a number");
  });

  it("reports the server time in UTC", async () => {
    const { serverTime } = (await admin.get("/admin/overview")).body.data;
    assert.ok(serverTime.endsWith("Z"));
    assert.ok(Math.abs(Date.parse(serverTime) - Date.now()) < 60_000);
  });
});

describe("audit log", () => {
  it("lists entries newest first with their actor", async () => {
    const response = await admin.get("/admin/audit-logs?pageSize=50");
    assert.equal(response.status, 200);
    const times = response.body.data.map((entry: { createdAt: string }) => entry.createdAt);
    assert.deepEqual(times, [...times].sort().reverse());
    assert.deepEqual(Object.keys(response.body.data[0]).sort(), [
      "action",
      "actor",
      "createdAt",
      "entityId",
      "entityType",
      "id",
      "ip",
      "metadata",
    ]);
    const withActor = response.body.data.find((entry: { actor: unknown }) => entry.actor !== null);
    assert.deepEqual(Object.keys(withActor.actor).sort(), ["email", "id", "name", "role"]);
  });

  it("never exposes a password or hash", async () => {
    const user = await createTempUser();
    await admin.patch(`/users/${user.id}`, { password: "audit-visible-check-1" });
    const response = await admin.get(`/admin/audit-logs?entityId=${user.id}`);
    assert.ok(response.body.data.length >= 2);
    assert.doesNotMatch(response.text, /audit-visible-check-1|passwordHash|scrypt/);
  });

  it("filters by action, ignoring letter case", async () => {
    await new Client().post("/auth/login", { email: tempEmail("fail"), password: "wrong" });
    const response = await admin.get("/admin/audit-logs?action=login_failed&pageSize=100");
    assert.ok(response.body.data.length >= 1);
    assert.ok(response.body.data.every((entry: { action: string }) => entry.action === "LOGIN_FAILED"));
    assert.equal(response.body.meta.total, await count(`SELECT count(*) FROM "AuditLog" WHERE action = 'LOGIN_FAILED'`));
  });

  it("filters by actor and by record", async () => {
    const user = await createTempUser();
    await admin.patch(`/users/${user.id}`, { name: "Audited" });

    const byActor = await admin.get(`/admin/audit-logs?actorId=${adminId}&pageSize=100`);
    assert.ok(byActor.body.data.every((entry: { actor: { id: string } }) => entry.actor.id === adminId));

    const byRecord = await admin.get(`/admin/audit-logs?entityType=User&entityId=${user.id}`);
    assert.deepEqual(
      byRecord.body.data.map((entry: { action: string }) => entry.action),
      ["USER_UPDATED", "USER_SIGNED_UP"],
    );
  });

  it("filters by time range, with either bound open", async () => {
    const total = await count('SELECT count(*) FROM "AuditLog"');
    const future = await admin.get("/admin/audit-logs?from=2099-01-01T00:00:00Z");
    assert.equal(future.body.meta.total, 0);

    const past = await admin.get("/admin/audit-logs?to=2000-01-01T00:00:00Z");
    assert.equal(past.body.meta.total, 0);

    const all = await admin.get(`/admin/audit-logs?from=2000-01-01T00:00:00%2B05:00&to=2099-01-01T00:00:00Z`);
    assert.ok(all.body.meta.total >= total);
  });

  it("pages without overlap", async () => {
    const first = await admin.get("/admin/audit-logs?pageSize=3&page=1");
    const second = await admin.get("/admin/audit-logs?pageSize=3&page=2");
    const ids = [...first.body.data, ...second.body.data].map((entry: { id: string }) => entry.id);
    assert.equal(ids.length, 6);
    assert.equal(new Set(ids).size, 6);
  });

  it("rejects invalid filters", async () => {
    const queries = [
      "from=2026-11-27T00:00:00", // no time zone
      "from=2026-11-27",
      "from=yesterday",
      "from=2026-11-27T10:00:00Z&to=2026-11-27T09:00:00Z", // ends before it starts
      "pageSize=1000",
      "pageSize=0",
      "page=0",
      `action=${encodeURIComponent("LOGIN' OR 1=1")}`,
      `actorId=${"a".repeat(65)}`,
    ];
    for (const query of queries) {
      assert.equal((await admin.get(`/admin/audit-logs?${query}`)).status, 422, query);
    }
    assert.equal((await admin.get("/admin/audit-logs?entityId=a%00b")).status, 400, "NUL character");
  });

  it("is read-only through the API", async () => {
    const total = await count('SELECT count(*) FROM "AuditLog"');
    assert.equal((await admin.post("/admin/audit-logs", { action: "FAKE" })).status, 405);
    assert.equal((await admin.delete("/admin/audit-logs")).status, 405);
    assert.equal((await admin.patch("/admin/audit-logs", { action: "FAKE" })).status, 405);
    assert.ok((await count('SELECT count(*) FROM "AuditLog"')) >= total, "nothing was removed");
  });
});
