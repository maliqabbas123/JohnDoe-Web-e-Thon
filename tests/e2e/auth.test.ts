import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, beforeEach, describe, it } from "node:test";
import {
  Client,
  TEST_ACCOUNTS,
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

const SESSION_COOKIE = "exam_session";
const admin = TEST_ACCOUNTS.admin;

beforeEach(resetRateLimits);
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

describe("sign-in failures", () => {
  it("rejects a request with no session", async () => {
    const response = await new Client().get("/auth/me");
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, "UNAUTHENTICATED");
  });

  it("gives the same response for a wrong password, an unknown email and a deactivated account", async () => {
    const deactivated = await createTempUser();
    await sql('UPDATE "User" SET "isActive" = false WHERE id = $1', [deactivated.id]);

    const client = new Client();
    const wrongPassword = await client.post("/auth/login", { email: admin.email, password: "wrong-password" });
    const unknownEmail = await client.post("/auth/login", { email: tempEmail("nobody"), password: "wrong-password" });
    const inactive = await client.post("/auth/login", { email: deactivated.email, password: deactivated.password });

    for (const response of [wrongPassword, unknownEmail, inactive]) {
      assert.equal(response.status, 401);
      assert.equal(response.setCookie.length, 0, "no cookie on failure");
    }
    assert.equal(unknownEmail.text, wrongPassword.text);
    assert.equal(inactive.text, wrongPassword.text);
  });

  it("validates input and names the field", async () => {
    const client = new Client();
    const badEmail = await client.post("/auth/login", { email: "not-an-email", password: "x" });
    assert.equal(badEmail.status, 422);
    assert.equal(badEmail.body.error.details[0].path, "email");

    const missing = await client.post("/auth/login", {});
    assert.equal(missing.status, 422);
    assert.deepEqual(missing.body.error.details.map((d: { path: string }) => d.path).sort(), ["email", "password"]);

    const tooLong = await client.post("/auth/login", { email: admin.email, password: "x".repeat(129) });
    assert.equal(tooLong.status, 422);
  });

  it("rejects fields it does not know, so a role cannot be sent at sign-in", async () => {
    const response = await new Client().post("/auth/login", {
      email: admin.email,
      password: admin.password,
      role: "ADMIN",
    });
    assert.equal(response.status, 422);
    assert.equal(response.setCookie.length, 0);
  });

  it("treats injection-shaped input as ordinary text", async () => {
    const usersBefore = await scalar<string>('SELECT count(*) FROM "User"');
    const client = new Client();

    const inEmail = await client.post("/auth/login", { email: "' OR '1'='1' --", password: "x" });
    assert.equal(inEmail.status, 422);

    const inPassword = await client.post("/auth/login", {
      email: admin.email,
      password: "' OR '1'='1'; DROP TABLE \"User\"; --",
    });
    assert.equal(inPassword.status, 401);

    assert.equal(await scalar<string>('SELECT count(*) FROM "User"'), usersBefore);
  });
});

describe("sign-in success", () => {
  it("returns the user and their role without any credential data", async () => {
    const client = new Client();
    const response = await client.post("/auth/login", { email: admin.email, password: admin.password });
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(response.body.data.user).sort(), ["email", "id", "name", "role"]);
    assert.equal(response.body.data.user.role, "ADMIN");
    assert.doesNotMatch(response.text, /passwordHash|scrypt/i);
    assert.ok(!Number.isNaN(Date.parse(response.body.data.expiresAt)));
  });

  it("detects the user type from the account, for every role", async () => {
    for (const account of [TEST_ACCOUNTS.examiner, TEST_ACCOUNTS.candidate]) {
      const client = await signIn(account.email, account.password);
      const me = await client.get("/auth/me");
      assert.equal(me.body.data.role, account.role);
      assert.equal(me.body.data.email, account.email);
    }
  });

  it("sets a hardened session cookie", async () => {
    const response = await new Client().post("/auth/login", { email: admin.email, password: admin.password });
    const cookie = response.setCookie.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(cookie, "session cookie is set");
    assert.match(cookie, /;\s*HttpOnly/i);
    assert.match(cookie, /;\s*Secure/i);
    assert.match(cookie, /;\s*Path=\//i);
    // The test server allows a cross-origin frontend, which requires SameSite=None.
    assert.match(cookie, /;\s*SameSite=None/i);

    const expires = /expires=([^;]+)/i.exec(cookie);
    assert.ok(expires, "cookie has an expiry");
    const hours = (Date.parse(expires[1]) - Date.now()) / 3_600_000;
    assert.ok(hours > 7.9 && hours < 8.1, `expires in about 8 hours, got ${hours.toFixed(2)}`);
  });

  it("stores only a hash of the session token", async () => {
    const client = await signInAs("candidate2");
    const token = client.cookie(SESSION_COOKIE);
    assert.ok(token && token.length >= 43, "token carries at least 256 bits");

    const stored = await sql<{ tokenHash: string }>(
      'SELECT s."tokenHash" FROM "Session" s JOIN "User" u ON u.id = s."userId" WHERE u.email = $1 AND s."revokedAt" IS NULL',
      [TEST_ACCOUNTS.candidate2.email],
    );
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0].tokenHash, token);
    assert.equal(stored[0].tokenHash, createHash("sha256").update(token).digest("hex"));
  });

  it("ignores letter case and surrounding spaces in the email", async () => {
    const response = await new Client().post("/auth/login", {
      email: `  ${admin.email.toUpperCase()}  `,
      password: admin.password,
    });
    assert.equal(response.status, 200);
  });

  it("treats visually identical Unicode passwords as the same password", async () => {
    // Full-width characters normalise (NFKC) to their ASCII equivalents.
    const user = await createTempUser("CANDIDATE", "ｐａｓｓｗｏｒｄ１２");
    const response = await new Client().post("/auth/login", { email: user.email, password: "password12" });
    assert.equal(response.status, 200);
  });
});

describe("session handling", () => {
  it("rejects a tampered, unknown or empty token", async () => {
    const client = await signInAs("candidate");
    const token = client.cookie(SESSION_COOKIE)!;

    for (const forged of [`${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, "not-a-real-token", "", "a".repeat(5000)]) {
      const intruder = new Client();
      intruder.setCookie(SESSION_COOKIE, forged);
      assert.equal((await intruder.get("/auth/me")).status, 401);
    }
  });

  it("rejects an expired session", async () => {
    const user = await createTempUser();
    assert.equal((await user.client.get("/auth/me")).status, 200);
    await sql(`UPDATE "Session" SET "expiresAt" = now() - interval '1 second' WHERE "userId" = $1`, [user.id]);
    assert.equal((await user.client.get("/auth/me")).status, 401);
  });

  it("rejects a revoked session", async () => {
    const user = await createTempUser();
    await sql('UPDATE "Session" SET "revokedAt" = now() WHERE "userId" = $1', [user.id]);
    assert.equal((await user.client.get("/auth/me")).status, 401);
  });

  it("ends an existing session the moment the account is deactivated", async () => {
    const user = await createTempUser();
    await sql('UPDATE "User" SET "isActive" = false WHERE id = $1', [user.id]);
    assert.equal((await user.client.get("/auth/me")).status, 401);
  });

  it("allows one active session per user: a new sign-in ends the previous one", async () => {
    const user = await createTempUser();
    const second = await signIn(user.email, user.password);
    assert.equal((await user.client.get("/auth/me")).status, 401, "first session is ended");
    assert.equal((await second.get("/auth/me")).status, 200, "second session works");
    assert.equal(
      await scalar<string>('SELECT count(*) FROM "Session" WHERE "userId" = $1 AND "revokedAt" IS NULL', [user.id]),
      "1",
    );
  });

  it("keeps sessions separate between users", async () => {
    const first = await createTempUser();
    const second = await createTempUser();
    assert.equal((await first.client.get("/auth/me")).body.data.id, first.id);
    assert.equal((await second.client.get("/auth/me")).body.data.id, second.id);
  });
});

describe("sign-out", () => {
  it("ends the session and clears the cookie", async () => {
    const user = await createTempUser();
    const token = user.client.cookie(SESSION_COOKIE)!;

    const response = await user.client.post("/auth/logout");
    assert.equal(response.status, 204);
    assert.equal(user.client.cookie(SESSION_COOKIE), undefined, "cookie is cleared");

    // A copied token must not work after sign-out.
    const replay = new Client();
    replay.setCookie(SESSION_COOKIE, token);
    assert.equal((await replay.get("/auth/me")).status, 401);
  });

  it("requires a session", async () => {
    assert.equal((await new Client().post("/auth/logout")).status, 401);
  });
});

describe("password change", () => {
  it("rejects a wrong current password, a reused password and a short password", async () => {
    const user = await createTempUser();
    const wrong = await user.client.post("/auth/change-password", {
      currentPassword: "not-the-password",
      newPassword: "second-password-2",
    });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.error.details[0].path, "currentPassword");

    const reused = await user.client.post("/auth/change-password", {
      currentPassword: user.password,
      newPassword: user.password,
    });
    assert.equal(reused.status, 422);

    const short = await user.client.post("/auth/change-password", {
      currentPassword: user.password,
      newPassword: "short",
    });
    assert.equal(short.status, 422);

    assert.equal((await signIn(user.email, user.password).then((c) => c.get("/auth/me"))).status, 200, "password unchanged");
  });

  it("requires a session", async () => {
    const response = await new Client().post("/auth/change-password", {
      currentPassword: "a",
      newPassword: "long-enough-password",
    });
    assert.equal(response.status, 401);
  });

  it("changes the password, keeps this session and ends the others", async () => {
    const user = await createTempUser();
    // A second sign-in replaces the first, so use the newest as "this device".
    const current = await signIn(user.email, user.password);
    const otherSessionId = await scalar<string>(
      `INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt") VALUES ($1, $2, $3, now() + interval '1 hour') RETURNING id`,
      [`e2e-${Date.now()}`, user.id, createHash("sha256").update("other-device").digest("hex")],
    );

    const response = await current.post("/auth/change-password", {
      currentPassword: user.password,
      newPassword: "second-password-2",
    });
    assert.equal(response.status, 204);
    assert.equal((await current.get("/auth/me")).status, 200, "this session stays signed in");
    assert.notEqual(
      await scalar<Date | null>('SELECT "revokedAt" FROM "Session" WHERE id = $1', [otherSessionId]),
      null,
      "the other session is ended",
    );

    assert.equal((await new Client().post("/auth/login", { email: user.email, password: user.password })).status, 401);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: "second-password-2" })).status, 200);
  });
});

describe("sign-in rate limiting", () => {
  it("locks an account after five failures, even for the right password", async () => {
    const user = await createTempUser();
    const client = new Client();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await client.post("/auth/login", { email: user.email, password: "wrong" });
      assert.equal(response.status, 401, `attempt ${attempt}`);
    }
    const locked = await client.post("/auth/login", { email: user.email, password: user.password });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, "RATE_LIMITED");
    const retryAfter = Number(locked.headers.get("retry-after"));
    assert.ok(retryAfter > 0 && retryAfter <= 900, `Retry-After within the 15-minute window, got ${retryAfter}`);
  });

  it("does not lock other accounts", async () => {
    const victim = await createTempUser();
    const bystander = await createTempUser();
    const client = new Client();
    for (let attempt = 0; attempt < 6; attempt++) {
      await client.post("/auth/login", { email: victim.email, password: "wrong" });
    }
    assert.equal((await client.post("/auth/login", { email: bystander.email, password: bystander.password })).status, 200);
  });

  it("unlocks when the window ends", async () => {
    const user = await createTempUser();
    const client = new Client();
    for (let attempt = 0; attempt < 6; attempt++) {
      await client.post("/auth/login", { email: user.email, password: "wrong" });
    }
    await sql(`UPDATE "RateLimit" SET "resetAt" = now() - interval '1 second'`);
    assert.equal((await client.post("/auth/login", { email: user.email, password: user.password })).status, 200);
  });

  it("clears the failure count after a successful sign-in", async () => {
    const user = await createTempUser();
    const client = new Client();
    const fail = () => client.post("/auth/login", { email: user.email, password: "wrong" });
    for (let attempt = 0; attempt < 4; attempt++) await fail();
    assert.equal((await client.post("/auth/login", { email: user.email, password: user.password })).status, 200);
    for (let attempt = 0; attempt < 4; attempt++) assert.equal((await fail()).status, 401);
  });

  it("limits attempts from one address across many accounts", async () => {
    const client = new Client();
    let last = 0;
    for (let attempt = 1; attempt <= 31; attempt++) {
      last = (await client.post("/auth/login", { email: tempEmail(`spray${attempt}`), password: "wrong" })).status;
      if (attempt <= 30) assert.equal(last, 401, `attempt ${attempt}`);
    }
    assert.equal(last, 429, "the 31st attempt from one address is refused");
  });

  it("does not count requests that fail validation", async () => {
    const client = new Client();
    for (let attempt = 0; attempt < 40; attempt++) {
      assert.equal((await client.post("/auth/login", { email: "invalid", password: "x" })).status, 422);
    }
  });
});

describe("audit trail", () => {
  it("records successful and failed sign-ins without the password", async () => {
    const user = await createTempUser();
    await new Client().post("/auth/login", { email: user.email, password: "wrong-and-secret-value" });
    await signIn(user.email, user.password);

    const actions = await sql<{ action: string }>(
      'SELECT action FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"',
      [user.id],
    );
    assert.deepEqual(
      actions.map((row) => row.action),
      ["USER_SIGNED_UP", "LOGIN_FAILED", "LOGIN_SUCCEEDED"],
    );
    assert.equal(
      await scalar<string>(
        `SELECT count(*) FROM "AuditLog" WHERE metadata::text LIKE '%wrong-and-secret-value%' OR metadata::text LIKE $1`,
        [`%${user.password}%`],
      ),
      "0",
    );
  });

  it("records a failed sign-in for an unknown email without an actor", async () => {
    const email = tempEmail("ghost");
    await new Client().post("/auth/login", { email, password: "whatever" });
    const rows = await sql<{ actorId: string | null }>(
      `SELECT "actorId" FROM "AuditLog" WHERE action = 'LOGIN_FAILED' AND metadata->>'email' = $1`,
      [email],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].actorId, null);
  });
});
