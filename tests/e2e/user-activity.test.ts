import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  Client,
  closeDatabase,
  createTempUser,
  removeTempUsers,
  resetRateLimits,
  scalar,
  signIn,
  signInAs,
  sql,
  tempEmail,
} from "./helpers";

let admin: Client;
let adminId: string;

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

const failSignIn = (email: string, times: number) =>
  (async () => {
    const client = new Client();
    let last = 0;
    for (let attempt = 0; attempt < times; attempt++) {
      last = (await client.post("/auth/login", { email, password: "wrong-password" })).status;
    }
    return last;
  })();

describe("access control", () => {
  const calls: [string, (id: string) => string][] = [
    ["GET", (id) => `/users/${id}/activity`],
    ["DELETE", (id) => `/users/${id}/sessions`],
    ["DELETE", (id) => `/users/${id}/sign-in-lock`],
  ];

  it("refuses callers without a session", async () => {
    for (const [method, path] of calls) {
      assert.equal((await new Client().request(method, path("some-id"))).status, 401, `${method} ${path("…")}`);
    }
  });

  for (const role of ["CANDIDATE", "EXAMINER"] as const) {
    it(`refuses a ${role.toLowerCase()}, even for their own account`, async () => {
      const user = await createTempUser(role);
      for (const [method, path] of calls) {
        for (const id of [user.id, adminId]) {
          const response = await user.client.request(method, path(id));
          assert.equal(response.status, 403, `${method} ${path(id)}`);
        }
      }
      assert.equal((await user.client.get("/auth/me")).status, 200, "their own session was not ended");
    });
  }

  it("returns 404 for a user that does not exist, whatever the id looks like", async () => {
    for (const id of ["missing", "a".repeat(200), "%00", encodeURIComponent("' OR 1=1 --")]) {
      for (const [method, path] of calls) {
        assert.equal((await admin.request(method, path(id))).status, 404, `${method} ${id}`);
      }
    }
  });

  it("refuses the state-changing calls from a foreign origin", async () => {
    const user = await createTempUser();
    for (const path of [`/users/${user.id}/sessions`, `/users/${user.id}/sign-in-lock`]) {
      const response = await admin.request("DELETE", path, { headers: { Origin: "https://evil.example" } });
      assert.equal(response.status, 403, path);
    }
    assert.equal((await user.client.get("/auth/me")).status, 200, "nothing was changed");
  });
});

describe("user activity", () => {
  it("shows the active session without any token material", async () => {
    const user = await createTempUser();
    const response = await admin.get(`/users/${user.id}/activity`);
    assert.equal(response.status, 200);
    const { sessions } = response.body.data;
    assert.equal(sessions.length, 1);
    assert.deepEqual(Object.keys(sessions[0]).sort(), ["createdAt", "expiresAt", "id", "ip", "lastSeenAt", "userAgent"]);
    assert.doesNotMatch(response.text, /tokenHash|passwordHash|scrypt/);

    const tokenHash = await scalar<string>('SELECT "tokenHash" FROM "Session" WHERE "userId" = $1', [user.id]);
    assert.ok(!response.text.includes(tokenHash), "the stored token hash is not exposed");
  });

  it("lists only sessions that are still active", async () => {
    const user = await createTempUser();
    await signIn(user.email, user.password); // replaces the first session
    await sql(
      `INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, now() - interval '1 hour')`,
      [`e2e-expired-${Date.now()}`, user.id, `e2e-expired-hash-${Date.now()}`],
    );
    const { sessions } = (await admin.get(`/users/${user.id}/activity`)).body.data;
    assert.equal(sessions.length, 1, "revoked and expired sessions are left out");
  });

  it("shows recent sign-ins, newest first, with the outcome", async () => {
    const user = await createTempUser();
    await failSignIn(user.email, 2);
    await signIn(user.email, user.password);

    const { signIns } = (await admin.get(`/users/${user.id}/activity`)).body.data;
    assert.deepEqual(
      signIns.map((entry: { succeeded: boolean }) => entry.succeeded),
      [true, false, false],
    );
    assert.deepEqual(Object.keys(signIns[0]).sort(), ["createdAt", "id", "ip", "succeeded"]);
    const times = signIns.map((entry: { createdAt: string }) => entry.createdAt);
    assert.deepEqual(times, [...times].sort().reverse());
  });

  it("shows account changes with who made them", async () => {
    const user = await createTempUser("CANDIDATE");
    await admin.patch(`/users/${user.id}`, { role: "EXAMINER" });

    const { accountChanges } = (await admin.get(`/users/${user.id}/activity`)).body.data;
    assert.deepEqual(
      accountChanges.map((entry: { action: string }) => entry.action),
      ["USER_UPDATED", "USER_SIGNED_UP"],
    );
    assert.equal(accountChanges[0].actor.id, adminId);
    assert.deepEqual(accountChanges[0].metadata.role, { from: "CANDIDATE", to: "EXAMINER" });
    assert.equal(accountChanges[1].actor.id, user.id, "the user signed themselves up");
  });

  it("returns at most 20 entries of each kind", async () => {
    const user = await createTempUser();
    for (let index = 0; index < 25; index++) {
      await sql(
        `INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "createdAt")
         VALUES ($1, 'LOGIN_FAILED', 'User', $2, now() - ($3 || ' seconds')::interval)`,
        [`e2e-many-${user.id}-${index}`, user.id, index],
      );
    }
    const { signIns } = (await admin.get(`/users/${user.id}/activity`)).body.data;
    assert.equal(signIns.length, 20);
    await sql(`DELETE FROM "AuditLog" WHERE id LIKE $1`, [`e2e-many-${user.id}-%`]);
  });

  it("does not mix in another user's activity", async () => {
    const first = await createTempUser();
    const second = await createTempUser();
    await failSignIn(second.email, 3);
    const { signIns, sessions } = (await admin.get(`/users/${first.id}/activity`)).body.data;
    assert.equal(signIns.length, 0);
    assert.equal(sessions.length, 1);
  });

  it("works for a deactivated user", async () => {
    const user = await createTempUser();
    await admin.patch(`/users/${user.id}`, { isActive: false });
    const response = await admin.get(`/users/${user.id}/activity`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.sessions.length, 0);
  });
});

describe("force sign-out", () => {
  it("ends the user's session at once and records it", async () => {
    const user = await createTempUser();
    assert.equal((await user.client.get("/auth/me")).status, 200);

    const response = await admin.delete(`/users/${user.id}/sessions`);
    assert.equal(response.status, 204);
    assert.equal(response.text, "");
    assert.equal((await user.client.get("/auth/me")).status, 401);

    const entry = await sql<{ actorId: string; metadata: { sessionsEnded: number } }>(
      `SELECT "actorId", metadata FROM "AuditLog" WHERE action = 'USER_SESSIONS_REVOKED' AND "entityId" = $1`,
      [user.id],
    );
    assert.equal(entry.length, 1);
    assert.equal(entry[0].actorId, adminId);
    assert.equal(entry[0].metadata.sessionsEnded, 1);
  });

  it("does not stop the user from signing in again", async () => {
    const user = await createTempUser();
    await admin.delete(`/users/${user.id}/sessions`);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: user.password })).status, 200);
  });

  it("is safe to repeat", async () => {
    const user = await createTempUser();
    assert.equal((await admin.delete(`/users/${user.id}/sessions`)).status, 204);
    assert.equal((await admin.delete(`/users/${user.id}/sessions`)).status, 204);
    const ended = await sql<{ metadata: { sessionsEnded: number } }>(
      `SELECT metadata FROM "AuditLog" WHERE action = 'USER_SESSIONS_REVOKED' AND "entityId" = $1 ORDER BY "createdAt"`,
      [user.id],
    );
    assert.deepEqual(ended.map((row) => row.metadata.sessionsEnded), [1, 0]);
  });

  it("leaves other users signed in", async () => {
    const target = await createTempUser();
    const bystander = await createTempUser();
    await admin.delete(`/users/${target.id}/sessions`);
    assert.equal((await bystander.client.get("/auth/me")).status, 200);
    assert.equal((await admin.get("/auth/me")).status, 200);
  });

  it("appears in the user's activity", async () => {
    const user = await createTempUser();
    await admin.delete(`/users/${user.id}/sessions`);
    const { accountChanges, sessions } = (await admin.get(`/users/${user.id}/activity`)).body.data;
    assert.equal(accountChanges[0].action, "USER_SESSIONS_REVOKED");
    assert.equal(sessions.length, 0);
  });
});

describe("sign-in lock", () => {
  it("is reported while an account is locked out, with the time it ends", async () => {
    const user = await createTempUser();
    const before = (await admin.get(`/users/${user.id}/activity`)).body.data.signInLock;
    assert.deepEqual(before, { locked: false, until: null });

    assert.equal(await failSignIn(user.email, 6), 429);
    const { signInLock } = (await admin.get(`/users/${user.id}/activity`)).body.data;
    assert.equal(signInLock.locked, true);
    const minutes = (Date.parse(signInLock.until) - Date.now()) / 60_000;
    assert.ok(minutes > 0 && minutes <= 15, `lock ends within 15 minutes, got ${minutes.toFixed(1)}`);
  });

  it("can be lifted by an administrator without changing the password", async () => {
    const user = await createTempUser();
    await failSignIn(user.email, 6);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: user.password })).status, 429);

    assert.equal((await admin.delete(`/users/${user.id}/sign-in-lock`)).status, 204);
    assert.equal((await admin.get(`/users/${user.id}/activity`)).body.data.signInLock.locked, false);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: user.password })).status, 200);
    assert.equal(
      await scalar<string>(`SELECT count(*) FROM "AuditLog" WHERE action = 'USER_SIGN_IN_UNLOCKED' AND "entityId" = $1`, [user.id]),
      "1",
    );
  });

  it("lifts the lock for that account only", async () => {
    const locked = await createTempUser();
    const alsoLocked = await createTempUser();
    await failSignIn(locked.email, 6);
    await failSignIn(alsoLocked.email, 6);

    await admin.delete(`/users/${locked.id}/sign-in-lock`);
    assert.equal((await new Client().post("/auth/login", { email: alsoLocked.email, password: alsoLocked.password })).status, 429);
  });

  it("does not treat wildcard characters in an email as a pattern", async () => {
    // "a_b@…" must not unlock "axb@…": an underscore matches any character in SQL LIKE.
    const stem = tempEmail("lock").replace("@exam.test", "");
    const underscore = await admin.post("/users", { email: `${stem}_x@exam.test`, name: "U", role: "CANDIDATE", password: "first-password-1" });
    const lookalike = await admin.post("/users", { email: `${stem}yx@exam.test`, name: "L", role: "CANDIDATE", password: "first-password-1" });
    assert.equal(underscore.status, 201);
    assert.equal(lookalike.status, 201);

    await failSignIn(lookalike.body.data.email, 6);
    await admin.delete(`/users/${underscore.body.data.id}/sign-in-lock`);
    assert.equal(
      (await admin.get(`/users/${lookalike.body.data.id}/activity`)).body.data.signInLock.locked,
      true,
      "the look-alike account is still locked",
    );
  });

  it("is safe to lift when nothing is locked", async () => {
    const user = await createTempUser();
    assert.equal((await admin.delete(`/users/${user.id}/sign-in-lock`)).status, 204);
  });

  it("does not lift the per-address limit", async () => {
    const user = await createTempUser();
    const client = new Client();
    for (let attempt = 0; attempt < 31; attempt++) {
      await client.post("/auth/login", { email: tempEmail(`spray${attempt}`), password: "wrong" });
    }
    await admin.delete(`/users/${user.id}/sign-in-lock`);
    assert.equal((await client.post("/auth/login", { email: user.email, password: user.password })).status, 429);
  });
});
