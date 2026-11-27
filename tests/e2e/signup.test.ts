import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import {
  Client,
  closeDatabase,
  removeTempUsers,
  resetRateLimits,
  scalar,
  sql,
  tempEmail,
} from "./helpers";

beforeEach(resetRateLimits);
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

const registration = (overrides: Record<string, unknown> = {}) => ({
  email: tempEmail("signup"),
  name: "New Person",
  password: "signup-password-1",
  role: "CANDIDATE",
  ...overrides,
});

describe("signing up", () => {
  for (const role of ["CANDIDATE", "EXAMINER"] as const) {
    it(`registers a ${role.toLowerCase()} and signs them in`, async () => {
      const client = new Client();
      const input = registration({ role });
      const response = await client.post("/auth/signup", input);
      assert.equal(response.status, 201);
      assert.equal(response.body.data.user.role, role);
      assert.equal(response.body.data.user.email, input.email);
      assert.deepEqual(Object.keys(response.body.data.user).sort(), ["email", "id", "name", "role"]);
      assert.doesNotMatch(response.text, /signup-password-1|passwordHash|scrypt/);

      const me = await client.get("/auth/me");
      assert.equal(me.status, 200);
      assert.equal(me.body.data.role, role);
    });
  }

  it("normalises the email and trims the name", async () => {
    const email = tempEmail("Case");
    const response = await new Client().post(
      "/auth/signup",
      registration({ email: `  ${email.toUpperCase()} `, name: "  Spaced Out  " }),
    );
    assert.equal(response.status, 201);
    assert.equal(response.body.data.user.email, email.toLowerCase());
    assert.equal(response.body.data.user.name, "Spaced Out");
  });

  it("stores the password hashed and lets the user sign in with it", async () => {
    const input = registration();
    await new Client().post("/auth/signup", input);
    const hash = await scalar<string>('SELECT "passwordHash" FROM "User" WHERE email = $1', [input.email]);
    assert.match(hash, /^scrypt\$/);
    assert.ok(!hash.includes(input.password));
    assert.equal(
      (await new Client().post("/auth/login", { email: input.email, password: input.password })).status,
      200,
    );
  });

  it("records the sign-up in the audit log", async () => {
    const response = await new Client().post("/auth/signup", registration({ role: "EXAMINER" }));
    const rows = await sql<{ metadata: { role: string } }>(
      `SELECT metadata FROM "AuditLog" WHERE action = 'USER_SIGNED_UP' AND "entityId" = $1`,
      [response.body.data.user.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metadata.role, "EXAMINER");
  });
});

describe("privilege escalation through sign-up", () => {
  it("never creates an administrator", async () => {
    const adminsBefore = await scalar<string>(`SELECT count(*) FROM "User" WHERE role = 'ADMIN'`);
    for (const role of ["ADMIN", "admin", "Admin", "SUPERUSER", "", null, ["ADMIN"], { value: "ADMIN" }, 1]) {
      const input = registration({ role });
      const response = await new Client().post("/auth/signup", input);
      assert.equal(response.status, 422, `role ${JSON.stringify(role)}`);
      assert.equal(await scalar<string>('SELECT count(*) FROM "User" WHERE email = $1', [input.email]), "0");
    }
    assert.equal(await scalar<string>(`SELECT count(*) FROM "User" WHERE role = 'ADMIN'`), adminsBefore);
  });

  it("requires a role", async () => {
    const input = registration();
    delete (input as Record<string, unknown>).role;
    assert.equal((await new Client().post("/auth/signup", input)).status, 422);
  });

  it("rejects fields that could set privileges or identity", async () => {
    for (const extra of [{ isActive: true }, { id: "chosen-id" }, { passwordHash: "x" }, { isAdmin: true }, { roles: ["ADMIN"] }]) {
      const response = await new Client().post("/auth/signup", registration(extra));
      assert.equal(response.status, 422, JSON.stringify(extra));
    }
  });

  it("gives new accounts no access to user management or administration", async () => {
    for (const role of ["CANDIDATE", "EXAMINER"] as const) {
      const client = new Client();
      await client.post("/auth/signup", registration({ role }));
      await resetRateLimits();
      for (const path of ["/users", "/admin/overview", "/admin/audit-logs"]) {
        assert.equal((await client.get(path)).status, 403, `${role} ${path}`);
      }
    }
  });
});

describe("sign-up validation", () => {
  it("refuses an email that is already registered, whatever its letter case", async () => {
    const input = registration();
    assert.equal((await new Client().post("/auth/signup", input)).status, 201);
    const again = await new Client().post("/auth/signup", registration({ email: input.email.toUpperCase() }));
    assert.equal(again.status, 409);
    assert.equal(again.setCookie.length, 0, "no session for the second caller");
  });

  it("creates exactly one account when the same sign-up races itself", async () => {
    const input = registration();
    const responses = await Promise.all(Array.from({ length: 5 }, () => new Client().post("/auth/signup", input)));
    const created = responses.filter((response) => response.status === 201).length;
    const conflicts = responses.filter((response) => response.status === 409).length;
    assert.equal(created, 1);
    assert.equal(conflicts, 4);
    assert.equal(await scalar<string>('SELECT count(*) FROM "User" WHERE email = $1', [input.email]), "1");
  });

  it("validates every field", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["bad email", { email: "nope" }],
      ["email over 254 characters", { email: `${"a".repeat(250)}@exam.test` }],
      ["blank name", { name: "   " }],
      ["name over 120 characters", { name: "n".repeat(121) }],
      ["short password", { password: "short" }],
      ["password over 128 characters", { password: "p".repeat(129) }],
      ["password as a number", { password: 12345678 }],
    ];
    for (const [label, overrides] of cases) {
      const response = await new Client().post("/auth/signup", registration(overrides));
      assert.equal(response.status, 422, label);
    }
  });

  it("refuses a NUL character instead of failing", async () => {
    const response = await new Client().post("/auth/signup", registration({ name: "Nul\u0000Name" }));
    assert.equal(response.status, 400);
  });

  it("accepts an 8-character password and a 128-character password", async () => {
    assert.equal((await new Client().post("/auth/signup", registration({ password: "8charsOK" }))).status, 201);
    assert.equal((await new Client().post("/auth/signup", registration({ password: "p".repeat(128) }))).status, 201);
  });

  it("refuses a sign-up sent from a foreign origin", async () => {
    const response = await new Client().post("/auth/signup", registration(), {
      headers: { Origin: "https://evil.example" },
    });
    assert.equal(response.status, 403);
  });
});

describe("sign-up rate limiting", () => {
  it("refuses the eleventh attempt from one address within an hour", async () => {
    const input = registration();
    let last = 0;
    for (let attempt = 1; attempt <= 11; attempt++) {
      // After the first, these are duplicates; they still count as attempts.
      last = (await new Client().post("/auth/signup", input)).status;
    }
    assert.equal(last, 429);
  });

  it("does not count requests that fail validation", async () => {
    for (let attempt = 0; attempt < 15; attempt++) {
      assert.equal((await new Client().post("/auth/signup", registration({ email: "invalid" }))).status, 422);
    }
  });
});
