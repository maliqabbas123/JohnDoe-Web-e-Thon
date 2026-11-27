import assert from "node:assert/strict";
import { after, before, beforeEach, it } from "node:test";
import { Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits, signIn, signInAs, sql, type TempUser } from "./helpers";

const path = "/me/preferences";
const defaults = { theme: "system", fontSize: 16, lineSpacing: 1.5, palettePosition: "right" };
const customized = { theme: "dark", fontSize: 24, lineSpacing: 1.75, palettePosition: "left" };
let candidate: TempUser;
let other: TempUser;

const put = (client: Client, json: unknown) => client.request("PUT", path, { json });

async function stored(userId = candidate.id) {
  return sql<{ workspace: unknown }>('SELECT workspace FROM "UserPreference" WHERE "userId" = $1', [userId]);
}

before(async () => {
  await resetRateLimits();
  candidate = await createTempUser("CANDIDATE");
  other = await createTempUser("CANDIDATE");
});

beforeEach(async () => {
  await resetRateLimits();
  await sql('DELETE FROM "UserPreference" WHERE "userId" IN ($1, $2)', [candidate.id, other.id]);
});

after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

it("requires a candidate session to read or replace preferences", async () => {
  const clients: [Client, number][] = [
    [new Client(), 401],
    [await signInAs("examiner"), 403],
    [await signInAs("admin"), 403],
  ];
  for (const [client, status] of clients) {
    assert.equal((await client.get(path)).status, status);
    assert.equal((await put(client, customized)).status, status);
  }
  assert.deepEqual(await stored(), []);
});

it("returns all defaults for a new candidate without creating a row", async () => {
  const response = await candidate.client.get(path);
  assert.equal(response.status, 200, response.text);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body, { data: defaults });
  assert.deepEqual(await stored(), []);
});

it("fills missing or obsolete stored fields independently without changing the row", async () => {
  const legacy = { theme: "dark", fontSize: "large", palettePosition: "left", layout: "wide" };
  await sql(
    'INSERT INTO "UserPreference" ("userId", workspace, "updatedAt") VALUES ($1, $2::jsonb, now())',
    [candidate.id, JSON.stringify(legacy)],
  );
  const response = await candidate.client.get(path);
  assert.equal(response.status, 200, response.text);
  assert.deepEqual(response.body, { data: { ...defaults, theme: "dark", palettePosition: "left" } });
  assert.deepEqual(await stored(), [{ workspace: legacy }]);
});

it("keeps settings across sessions and scopes reads and writes to the signed-in candidate", async () => {
  const response = await put(candidate.client, customized);
  assert.equal(response.status, 200, response.text);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(response.body, { data: customized });
  assert.deepEqual(await stored(), [{ workspace: customized }]);

  const signedInAgain = await signIn(candidate.email, candidate.password);
  candidate.client = signedInAgain;
  assert.deepEqual((await signedInAgain.get(path)).body, { data: customized });
  assert.deepEqual((await other.client.get(path + "?userId=" + candidate.id)).body, { data: defaults });

  const spoof = await put(other.client, { userId: candidate.id, theme: "light" });
  assert.equal(spoof.status, 422, spoof.text);
  assert.deepEqual(await stored(other.id), []);
  const another = await other.client.request("PUT", path + "?userId=" + candidate.id, { json: { theme: "light" } });
  assert.equal(another.status, 200, another.text);
  assert.deepEqual(await stored(other.id), [{ workspace: { ...defaults, theme: "light" } }]);
  assert.deepEqual(await stored(), [{ workspace: customized }]);
});

it("replaces settings, accepts the numeric bounds, and resets omitted fields", async () => {
  const lowerBounds = { ...customized, fontSize: 12, lineSpacing: 1 };
  const upperBounds = { ...customized, fontSize: 32, lineSpacing: 2 };
  for (const settings of [lowerBounds, upperBounds]) {
    const response = await put(candidate.client, settings);
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body, { data: settings });
  }

  const partial = await put(candidate.client, { fontSize: 18 });
  assert.equal(partial.status, 200, partial.text);
  assert.deepEqual(partial.body, { data: { ...defaults, fontSize: 18 } });
  const reset = await put(candidate.client, {});
  assert.equal(reset.status, 200, reset.text);
  assert.deepEqual(reset.body, { data: defaults });
  assert.deepEqual(await stored(), [{ workspace: defaults }]);
});

it("rejects invalid values and unknown fields without changing saved settings", async () => {
  assert.equal((await put(candidate.client, customized)).status, 200);
  const invalid = [
    null, [], "dark",
    { theme: "sepia" }, { theme: "' OR '1'='1" }, { theme: null },
    { fontSize: 11 }, { fontSize: 33 }, { fontSize: 12.5 }, { fontSize: "20" },
    { lineSpacing: 0.75 }, { lineSpacing: 2.25 }, { lineSpacing: 1.4 }, { lineSpacing: "1.5" },
    { palettePosition: "bottom" }, { palettePosition: false },
    { extra: true }, { workspace: customized },
  ];
  for (const body of invalid) {
    const response = await put(candidate.client, body);
    assert.equal(response.status, 422, response.text);
    assert.equal(response.body.error.code, "VALIDATION_FAILED");
  }
  assert.deepEqual(await stored(), [{ workspace: customized }]);
});

it("uses the shared origin and body protections", async () => {
  const foreign = await candidate.client.request("PUT", path, {
    json: customized, headers: { Origin: "https://untrusted.example" },
  });
  assert.equal(foreign.status, 403, foreign.text);

  for (const rawBody of ["{", '{"theme":"d\\u0000ark"}']) {
    const response = await candidate.client.request("PUT", path, { rawBody });
    assert.equal(response.status, 400, response.text);
  }
  const tooLarge = await candidate.client.request("PUT", path, { json: { theme: "x".repeat(65_536) } });
  assert.equal(tooLarge.status, 413, tooLarge.text);
  assert.deepEqual(await stored(), []);
});

it("keeps one complete record when first saves race and the request is retried", async () => {
  const responses = await Promise.all([
    put(candidate.client, customized),
    put(candidate.client, customized),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body, { data: customized });
  }
  assert.equal((await put(candidate.client, customized)).status, 200);
  assert.deepEqual(await stored(), [{ workspace: customized }]);
});
