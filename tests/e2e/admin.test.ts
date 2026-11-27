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
    const response = await admin.get("/admin/audit-logs?action=login_failed&pageSize=100&withTotal=true");
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
    const future = await admin.get("/admin/audit-logs?from=2099-01-01T00:00:00Z&withTotal=true");
    assert.equal(future.body.meta.total, 0);

    const past = await admin.get("/admin/audit-logs?to=2000-01-01T00:00:00Z&withTotal=true");
    assert.equal(past.body.meta.total, 0);

    const all = await admin.get(`/admin/audit-logs?from=2000-01-01T00:00:00%2B05:00&to=2099-01-01T00:00:00Z&withTotal=true`);
    assert.ok(all.body.meta.total >= total);
  });

  // Seven entries for one made-up record, so paging can be checked exactly.
  async function seedEntries(count: number, sameInstant = false): Promise<string> {
    const entityId = `e2e-paging-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    for (let index = 0; index < count; index++) {
      await sql(
        `INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "createdAt")
         VALUES ($1, 'LOGOUT', 'Paging', $2, $3::timestamptz - ($4 || ' seconds')::interval)`,
        [`${entityId}-${index}`, entityId, "2026-01-01T00:00:00Z", sameInstant ? 0 : index],
      );
    }
    return entityId;
  }

  async function readAll(query: string, pageSize: number) {
    const ids: string[] = [];
    const pages: { total?: number; nextCursor: string | null }[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `/admin/audit-logs?${query}&pageSize=${pageSize}${cursor ? `&cursor=${cursor}` : ""}`;
      const response = await admin.get(url);
      assert.equal(response.status, 200);
      assert.ok(response.body.data.length <= pageSize);
      ids.push(...response.body.data.map((entry: { id: string }) => entry.id));
      pages.push(response.body.meta);
      cursor = response.body.meta.nextCursor;
    } while (cursor);
    return { ids, pages };
  }

  it("pages by cursor: every entry exactly once, in order, then stops", async () => {
    const entityId = await seedEntries(7);
    const { ids, pages } = await readAll(`entityId=${entityId}`, 3);
    assert.deepEqual(ids, [0, 1, 2, 3, 4, 5, 6].map((index) => `${entityId}-${index}`));
    assert.equal(pages.length, 3);
    assert.equal(pages.at(-1)!.nextCursor, null);
  });

  it("reports the total only when asked, and only on the first page", async () => {
    const entityId = await seedEntries(5);
    const counted = await readAll(`entityId=${entityId}&withTotal=true`, 2);
    assert.equal(counted.pages[0].total, 5);
    assert.ok(counted.pages.slice(1).every((meta) => meta.total === undefined));

    const plain = await readAll(`entityId=${entityId}`, 2);
    assert.ok(plain.pages.every((meta) => meta.total === undefined));
    assert.deepEqual(plain.ids, counted.ids);
  });

  it("returns no cursor when everything fits on one page, including an exact fit", async () => {
    const entityId = await seedEntries(4);
    for (const pageSize of [4, 10]) {
      const response = await admin.get(`/admin/audit-logs?entityId=${entityId}&pageSize=${pageSize}`);
      assert.equal(response.body.data.length, 4);
      assert.equal(response.body.meta.nextCursor, null, `pageSize ${pageSize}`);
    }
  });

  it("pages correctly through entries that share one timestamp", async () => {
    const entityId = await seedEntries(5, true);
    const { ids } = await readAll(`entityId=${entityId}`, 2);
    assert.equal(ids.length, 5);
    assert.equal(new Set(ids).size, 5);
  });

  it("is not disturbed by entries written while paging", async () => {
    const first = await admin.get("/admin/audit-logs?pageSize=3");
    // New activity arrives at the top of the log.
    await new Client().post("/auth/login", { email: tempEmail("during-paging"), password: "wrong" });
    await new Client().post("/auth/login", { email: tempEmail("during-paging"), password: "wrong" });
    const second = await admin.get(`/admin/audit-logs?pageSize=3&cursor=${first.body.meta.nextCursor}`);

    const firstIds = first.body.data.map((entry: { id: string }) => entry.id);
    const secondIds = second.body.data.map((entry: { id: string }) => entry.id);
    assert.equal(secondIds.filter((id: string) => firstIds.includes(id)).length, 0, "no entry repeats");
    assert.ok(second.body.data[0].createdAt <= first.body.data.at(-1).createdAt, "continues where the first page ended");
  });

  it("rejects a cursor it did not issue", async () => {
    const forged = [
      "not-a-cursor",
      Buffer.from("{}").toString("base64url"),
      Buffer.from(JSON.stringify(["not-a-date", "id"])).toString("base64url"),
      Buffer.from(JSON.stringify(["2026-01-01T00:00:00Z", 42])).toString("base64url"),
      Buffer.from(JSON.stringify(["2026-01-01T00:00:00Z", "a".repeat(100)])).toString("base64url"),
      Buffer.from(JSON.stringify(["2026-01-01T00:00:00Z", "'; DROP TABLE \"AuditLog\"; --"])).toString("base64url").padEnd(250, "A"),
    ];
    for (const cursor of forged) {
      const response = await admin.get(`/admin/audit-logs?cursor=${cursor}`);
      assert.equal(response.status, 422, cursor.slice(0, 40));
    }
  });

  it("treats a well-formed but made-up cursor as a plain position", async () => {
    const before = await count('SELECT count(*) FROM "AuditLog"');
    const cursor = Buffer.from(JSON.stringify(["1999-01-01T00:00:00.000Z", "'; DROP TABLE x; --"])).toString("base64url");
    const response = await admin.get(`/admin/audit-logs?cursor=${cursor}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, []);
    assert.ok((await count('SELECT count(*) FROM "AuditLog"')) >= before);
  });

  it("rejects invalid filters", async () => {
    const queries = [
      "from=2026-11-27T00:00:00", // no time zone
      "from=2026-11-27",
      "from=yesterday",
      "from=2026-11-27T10:00:00Z&to=2026-11-27T09:00:00Z", // ends before it starts
      "pageSize=1000",
      "pageSize=0",
      "withTotal=yes",
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
