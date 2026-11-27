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

before(async () => {
  await resetRateLimits();
  admin = await signInAs("admin");
});
beforeEach(resetRateLimits);
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

const newUser = (overrides: Record<string, unknown> = {}) => ({
  email: tempEmail("made"),
  name: "Made By Admin",
  role: "CANDIDATE",
  password: "first-password-1",
  ...overrides,
});

describe("access control", () => {
  const calls: [string, string, unknown?][] = [
    ["GET", "/users"],
    ["POST", "/users", newUser({ role: "ADMIN" })],
    ["GET", "/users/some-id"],
    ["PATCH", "/users/some-id", { role: "ADMIN" }],
  ];

  it("refuses every user-management call without a session", async () => {
    for (const [method, path, json] of calls) {
      const response = await new Client().request(method, path, { json });
      assert.equal(response.status, 401, `${method} ${path}`);
    }
  });

  for (const role of ["CANDIDATE", "EXAMINER"] as const) {
    it(`refuses every user-management call from a ${role.toLowerCase()}`, async () => {
      const user = await createTempUser(role);
      for (const [method, path, json] of calls) {
        const response = await user.client.request(method, path, { json });
        assert.equal(response.status, 403, `${method} ${path}`);
        assert.equal(response.body.error.code, "FORBIDDEN");
      }
    });
  }

  it("does not let a non-administrator promote themselves", async () => {
    const user = await createTempUser("EXAMINER");
    const response = await user.client.patch(`/users/${user.id}`, { role: "ADMIN" });
    assert.equal(response.status, 403);
    assert.equal(await scalar<string>('SELECT role FROM "User" WHERE id = $1', [user.id]), "EXAMINER");
  });
});

describe("listing users", () => {
  it("returns a page with totals and no credential data", async () => {
    const response = await admin.get("/users");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.meta, {
      page: 1,
      pageSize: 20,
      total: Number(await scalar<string>('SELECT count(*) FROM "User"')),
    });
    assert.deepEqual(Object.keys(response.body.data[0]).sort(), [
      "createdAt",
      "email",
      "id",
      "isActive",
      "name",
      "role",
      "updatedAt",
    ]);
    assert.doesNotMatch(response.text, /passwordHash|scrypt/i);
  });

  it("orders newest first", async () => {
    const created = await createTempUser();
    const response = await admin.get("/users?pageSize=1");
    assert.equal(response.body.data[0].id, created.id);
  });

  it("pages without overlap and returns an empty page past the end", async () => {
    await createTempUser();
    await createTempUser();
    const first = await admin.get("/users?pageSize=2&page=1");
    const second = await admin.get("/users?pageSize=2&page=2");
    const ids = [...first.body.data, ...second.body.data].map((user: { id: string }) => user.id);
    assert.equal(new Set(ids).size, ids.length, "no user appears on two pages");

    const beyond = await admin.get("/users?page=100000");
    assert.equal(beyond.status, 200);
    assert.deepEqual(beyond.body.data, []);
    assert.equal(beyond.body.meta.total, first.body.meta.total);
  });

  it("filters by role and by activation", async () => {
    const examiner = await createTempUser("EXAMINER");
    await sql('UPDATE "User" SET "isActive" = false WHERE id = $1', [examiner.id]);

    const examiners = await admin.get("/users?role=EXAMINER&pageSize=100");
    assert.ok(examiners.body.data.length >= 1);
    assert.ok(examiners.body.data.every((user: { role: string }) => user.role === "EXAMINER"));

    const inactive = await admin.get("/users?isActive=false&pageSize=100");
    assert.ok(inactive.body.data.some((user: { id: string }) => user.id === examiner.id));
    assert.ok(inactive.body.data.every((user: { isActive: boolean }) => user.isActive === false));
  });

  it("searches name and email without regard to case", async () => {
    const email = tempEmail("Findable");
    const created = await admin.post("/users", newUser({ email, name: "Zebediah Quux" }));
    assert.equal(created.status, 201);

    const byName = await admin.get("/users?q=zebediah%20QUUX");
    assert.deepEqual(byName.body.data.map((user: { id: string }) => user.id), [created.body.data.id]);

    const byEmail = await admin.get(`/users?q=${encodeURIComponent(email.toUpperCase())}`);
    assert.equal(byEmail.body.data.length, 1);
  });

  it("treats search wildcards as ordinary characters", async () => {
    const percent = await admin.get("/users?q=%25");
    const underscore = await admin.get("/users?q=_");
    const backslash = await admin.get("/users?q=%5C");
    assert.equal(percent.body.meta.total, 0, "a percent sign does not match everything");
    assert.equal(underscore.body.meta.total, 0, "an underscore does not match any character");
    assert.equal(backslash.status, 200);
    assert.equal(backslash.body.meta.total, 0);
  });

  it("finds a name that really contains a wildcard character", async () => {
    const created = await admin.post("/users", newUser({ name: "100%_Sure" }));
    assert.equal(created.status, 201);
    for (const term of ["100%25", "%25_S", "0%25_sure"]) {
      const found = await admin.get(`/users?q=${term}`);
      assert.deepEqual(found.body.data.map((user: { id: string }) => user.id), [created.body.data.id], term);
    }
  });

  it("refuses a NUL character in the query instead of failing", async () => {
    const response = await admin.get("/users?q=a%00b");
    assert.equal(response.status, 400);
  });

  it("rejects invalid paging and filters", async () => {
    for (const query of ["pageSize=0", "pageSize=101", "pageSize=abc", "page=0", "page=-1", "page=1.5", "role=ROOT", "isActive=yes"]) {
      const response = await admin.get(`/users?${query}`);
      assert.equal(response.status, 422, query);
    }
  });

  it("is safe against injection through the search term", async () => {
    const before = await scalar<string>('SELECT count(*) FROM "User"');
    const response = await admin.get(`/users?q=${encodeURIComponent("'; DROP TABLE \"User\"; --")}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.meta.total, 0);
    assert.equal(await scalar<string>('SELECT count(*) FROM "User"'), before);
  });
});

describe("creating users", () => {
  it("creates an account that can sign in, with the email normalised", async () => {
    const email = tempEmail("Mixed");
    const input = newUser({ email: `  ${email.toUpperCase()}  `, name: "  Padded Name  ", role: "EXAMINER" });
    const response = await admin.post("/users", input);
    assert.equal(response.status, 201);
    assert.equal(response.body.data.email, email.toLowerCase());
    assert.equal(response.body.data.name, "Padded Name");
    assert.equal(response.body.data.role, "EXAMINER");
    assert.equal(response.body.data.isActive, true);
    assert.doesNotMatch(response.text, /passwordHash|scrypt|first-password-1/i);

    const client = await signIn(email, "first-password-1");
    assert.equal((await client.get("/auth/me")).body.data.role, "EXAMINER");
  });

  it("lets an administrator create another administrator", async () => {
    const response = await admin.post("/users", newUser({ role: "ADMIN" }));
    assert.equal(response.status, 201);
    assert.equal(response.body.data.role, "ADMIN");
  });

  it("refuses a duplicate email, whatever its letter case", async () => {
    const email = tempEmail("dup");
    assert.equal((await admin.post("/users", newUser({ email }))).status, 201);
    const again = await admin.post("/users", newUser({ email: email.toUpperCase() }));
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, "CONFLICT");
  });

  it("creates exactly one account when the same request races itself", async () => {
    const input = newUser();
    const responses = await Promise.all(Array.from({ length: 6 }, () => admin.post("/users", input)));
    const statuses = responses.map((response) => response.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
    assert.equal(await scalar<string>('SELECT count(*) FROM "User" WHERE email = $1', [input.email]), "1");
  });

  it("validates every field", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["bad email", { email: "nope" }, "email"],
      ["blank name", { name: "   " }, "name"],
      ["name over 120 characters", { name: "n".repeat(121) }, "name"],
      ["unknown role", { role: "ROOT" }, "role"],
      ["lower-case role", { role: "admin" }, "role"],
      ["short password", { password: "short" }, "password"],
      ["password over 128 characters", { password: "p".repeat(129) }, "password"],
      ["number as name", { name: 42 }, "name"],
    ];
    for (const [label, overrides, path] of cases) {
      const response = await admin.post("/users", newUser(overrides));
      assert.equal(response.status, 422, label);
      assert.ok(
        response.body.error.details.some((detail: { path: string }) => detail.path === path),
        `${label} names the field`,
      );
    }
  });

  it("rejects fields it does not know", async () => {
    for (const extra of [{ isActive: false }, { id: "chosen" }, { passwordHash: "x" }, { createdAt: "2020-01-01" }]) {
      const response = await admin.post("/users", newUser(extra));
      assert.equal(response.status, 422, JSON.stringify(extra));
    }
  });

  it("refuses a NUL character in any field instead of failing", async () => {
    const before = await scalar<string>('SELECT count(*) FROM "User"');
    for (const overrides of [{ name: "Nul\u0000Name" }, { email: `nul\u0000${tempEmail("x")}` }, { password: "nul\u0000-password" }]) {
      const response = await admin.post("/users", newUser(overrides));
      assert.equal(response.status, 400, JSON.stringify(overrides));
    }
    assert.equal(await scalar<string>('SELECT count(*) FROM "User"'), before);
  });

  it("stores unusual but valid text unchanged", async () => {
    const name = `O'Brien "Zoë" <b>&amp; 名前 🎓`;
    const created = await admin.post("/users", newUser({ name }));
    assert.equal(created.status, 201);
    assert.equal(created.body.data.name, name);
    assert.equal((await admin.get(`/users/${created.body.data.id}`)).body.data.name, name);
  });
});

describe("reading one user", () => {
  it("returns the user", async () => {
    const user = await createTempUser();
    const response = await admin.get(`/users/${user.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.email, user.email);
    assert.doesNotMatch(response.text, /passwordHash|scrypt/i);
  });

  it("returns 404 for ids that do not exist, whatever their shape", async () => {
    for (const id of ["missing", "a".repeat(500), encodeURIComponent("' OR 1=1 --"), "%00", "..%2F..%2Fetc", "a%00b", "%F0%9F%8E%93"]) {
      const response = await admin.get(`/users/${id}`);
      assert.equal(response.status, 404, id);
      const patch = await admin.patch(`/users/${id}`, { name: "X" });
      assert.equal(patch.status, 404, `PATCH ${id}`);
    }
  });
});

describe("updating users", () => {
  it("changes the name without ending the user's session", async () => {
    const user = await createTempUser();
    const response = await admin.patch(`/users/${user.id}`, { name: "Renamed" });
    assert.equal(response.status, 200);
    assert.equal(response.body.data.name, "Renamed");
    assert.equal((await user.client.get("/auth/me")).status, 200);
  });

  it("does not end the session when the role is set to its current value", async () => {
    const user = await createTempUser("CANDIDATE");
    assert.equal((await admin.patch(`/users/${user.id}`, { role: "CANDIDATE", isActive: true })).status, 200);
    assert.equal((await user.client.get("/auth/me")).status, 200);
  });

  it("ends the user's session at once when their role changes", async () => {
    const user = await createTempUser("CANDIDATE");
    assert.equal((await admin.patch(`/users/${user.id}`, { role: "EXAMINER" })).status, 200);
    assert.equal((await user.client.get("/auth/me")).status, 401);
    const again = await signIn(user.email, user.password);
    assert.equal((await again.get("/auth/me")).body.data.role, "EXAMINER");
  });

  it("deactivates and reactivates an account", async () => {
    const user = await createTempUser();
    assert.equal((await admin.patch(`/users/${user.id}`, { isActive: false })).status, 200);
    assert.equal((await user.client.get("/auth/me")).status, 401, "session ended");
    assert.equal(
      (await new Client().post("/auth/login", { email: user.email, password: user.password })).status,
      401,
      "cannot sign in while deactivated",
    );

    assert.equal((await admin.patch(`/users/${user.id}`, { isActive: true })).status, 200);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: user.password })).status, 200);
  });

  it("resets a password, ending the user's sessions", async () => {
    const user = await createTempUser();
    const response = await admin.patch(`/users/${user.id}`, { password: "reset-by-admin-9" });
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /reset-by-admin-9|passwordHash/);
    assert.equal((await user.client.get("/auth/me")).status, 401);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: user.password })).status, 401);
    assert.equal((await new Client().post("/auth/login", { email: user.email, password: "reset-by-admin-9" })).status, 200);
  });

  it("stops an administrator from demoting or deactivating themselves", async () => {
    const me = (await admin.get("/auth/me")).body.data.id;
    for (const change of [{ role: "CANDIDATE" }, { isActive: false }]) {
      const response = await admin.patch(`/users/${me}`, change);
      assert.equal(response.status, 409, JSON.stringify(change));
    }
    assert.equal((await admin.get("/auth/me")).status, 200, "the administrator is still signed in");
  });

  it("lets an administrator rename themselves", async () => {
    const me = (await admin.get("/auth/me")).body.data;
    assert.equal((await admin.patch(`/users/${me.id}`, { name: me.name })).status, 200);
  });

  it("rejects an empty change, unknown fields and invalid values", async () => {
    const user = await createTempUser();
    for (const change of [{}, { email: "new@exam.test" }, { id: "x" }, { role: "ROOT" }, { isActive: "no" }, { password: "short" }, { name: "" }]) {
      const response = await admin.patch(`/users/${user.id}`, change);
      assert.equal(response.status, 422, JSON.stringify(change));
    }
  });

  it("returns 404 when the user does not exist", async () => {
    assert.equal((await admin.patch("/users/missing", { name: "Nobody" })).status, 404);
  });

  it("records what changed, and never the password", async () => {
    const user = await createTempUser("CANDIDATE");
    await admin.patch(`/users/${user.id}`, { role: "EXAMINER", password: "audited-reset-77" });
    const rows = await sql<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM "AuditLog" WHERE action = 'USER_UPDATED' AND "entityId" = $1`,
      [user.id],
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].metadata.role, { from: "CANDIDATE", to: "EXAMINER" });
    assert.equal(rows[0].metadata.passwordReset, true);
    assert.doesNotMatch(JSON.stringify(rows[0].metadata), /audited-reset-77|scrypt/);
  });
});
