import assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { BASE_URL, Client, closeDatabase, resetRateLimits } from "./helpers";

// The test server is started with ALLOWED_ORIGINS=https://frontend.example.
const ALLOWED_ORIGIN = "https://frontend.example";
const FOREIGN_ORIGIN = "https://evil.example";

beforeEach(resetRateLimits);
after(closeDatabase);

describe("health", () => {
  it("reports the service and database as up", async () => {
    const response = await new Client().get("/health");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.status, "ok");
    assert.equal(response.body.data.database, "up");
    assert.ok(!Number.isNaN(Date.parse(response.body.data.serverTime)));
    assert.ok(response.body.data.serverTime.endsWith("Z"), "server time is UTC");
  });
});

describe("security headers", () => {
  it("are sent on API responses", async () => {
    const { headers } = await new Client().get("/health");
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("referrer-policy"), "strict-origin-when-cross-origin");
    assert.match(headers.get("strict-transport-security") ?? "", /max-age=\d+/);
    assert.match(headers.get("content-security-policy") ?? "", /default-src 'none'/);
    assert.match(headers.get("permissions-policy") ?? "", /camera=\(\)/);
  });

  it("are sent on pages", async () => {
    const { headers, status } = await new Client().get(`${BASE_URL}/`);
    assert.equal(status, 200);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.get("x-frame-options"), "DENY");
  });

  it("do not advertise the framework", async () => {
    const { headers } = await new Client().get("/health");
    assert.equal(headers.get("x-powered-by"), null);
  });

  it("mark API responses as uncacheable, including errors", async () => {
    const ok = await new Client().get("/health");
    const denied = await new Client().get("/auth/me");
    assert.equal(ok.headers.get("cache-control"), "no-store");
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "no-store");
  });
});

describe("error format", () => {
  it("uses the standard shape", async () => {
    const response = await new Client().get("/auth/me");
    assert.deepEqual(Object.keys(response.body), ["error"]);
    assert.equal(response.body.error.code, "UNAUTHENTICATED");
    assert.equal(typeof response.body.error.message, "string");
  });

  it("returns 404 for an unknown API path", async () => {
    const response = await new Client().get("/does-not-exist");
    assert.equal(response.status, 404);
  });

  it("returns 405 for an unsupported method", async () => {
    const response = await new Client().get("/auth/login");
    assert.equal(response.status, 405);
  });
});

describe("request bodies", () => {
  const client = new Client();

  it("rejects invalid JSON with 400", async () => {
    const response = await client.request("POST", "/auth/login", { rawBody: "{not json" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "BAD_REQUEST");
  });

  it("rejects an empty body with 400", async () => {
    const response = await client.request("POST", "/auth/login", { rawBody: "" });
    assert.equal(response.status, 400);
  });

  for (const [label, body] of [
    ["null", "null"],
    ["an array", "[]"],
    ["a string", '"text"'],
    ["a number", "42"],
  ] as const) {
    it(`rejects ${label} with 422`, async () => {
      const response = await client.request("POST", "/auth/login", { rawBody: body });
      assert.equal(response.status, 422);
      assert.equal(response.body.error.code, "VALIDATION_FAILED");
    });
  }

  it("rejects a body over 64 KB with 413", async () => {
    const response = await client.post("/auth/login", {
      email: "a@exam.test",
      password: "x".repeat(70 * 1024),
    });
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, "PAYLOAD_TOO_LARGE");
  });

  it("accepts a body just under the limit and validates it normally", async () => {
    const response = await client.post("/auth/login", {
      email: "a@exam.test",
      password: "x".repeat(60 * 1024),
    });
    assert.equal(response.status, 422);
  });
});

describe("cross-site request forgery protection", () => {
  it("refuses a state-changing request from a foreign origin", async () => {
    const response = await new Client().post("/auth/logout", undefined, {
      headers: { Origin: FOREIGN_ORIGIN },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body.error.code, "FORBIDDEN");
  });

  it("checks the origin before authentication", async () => {
    // Without the origin check this would be 401; 403 proves the order.
    const response = await new Client().post(
      "/users",
      { email: "x@exam.test", name: "X", role: "ADMIN", password: "long-enough-1" },
      { headers: { Origin: FOREIGN_ORIGIN } },
    );
    assert.equal(response.status, 403);
  });

  it("allows the application's own origin", async () => {
    const response = await new Client().post("/auth/logout", undefined, {
      headers: { Origin: BASE_URL },
    });
    assert.equal(response.status, 401, "passes the origin check and reaches authentication");
  });

  it("allows an origin listed in ALLOWED_ORIGINS", async () => {
    const response = await new Client().post("/auth/logout", undefined, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    assert.equal(response.status, 401);
  });

  it("treats a look-alike origin as foreign", async () => {
    for (const origin of [`${ALLOWED_ORIGIN}.evil.example`, "http://frontend.example", "null"]) {
      const response = await new Client().post("/auth/logout", undefined, { headers: { Origin: origin } });
      assert.equal(response.status, 403, origin);
    }
  });

  it("does not apply the check to reads", async () => {
    const response = await new Client().get("/health", { headers: { Origin: FOREIGN_ORIGIN } });
    assert.equal(response.status, 200);
  });
});

describe("cross-origin resource sharing", () => {
  it("answers a preflight from an allowed origin", async () => {
    const response = await new Client().request("OPTIONS", "/auth/login", {
      headers: { Origin: ALLOWED_ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(response.headers.get("access-control-allow-credentials"), "true");
    assert.match(response.headers.get("access-control-allow-methods") ?? "", /PATCH/);
  });

  it("refuses a preflight from a foreign origin", async () => {
    const response = await new Client().request("OPTIONS", "/auth/login", {
      headers: { Origin: FOREIGN_ORIGIN, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });

  it("adds CORS headers to responses for an allowed origin only", async () => {
    const allowed = await new Client().get("/health", { headers: { Origin: ALLOWED_ORIGIN } });
    const foreign = await new Client().get("/health", { headers: { Origin: FOREIGN_ORIGIN } });
    assert.equal(allowed.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);
  });

  it("never uses a wildcard origin", async () => {
    const response = await new Client().get("/health", { headers: { Origin: ALLOWED_ORIGIN } });
    assert.notEqual(response.headers.get("access-control-allow-origin"), "*");
  });
});
