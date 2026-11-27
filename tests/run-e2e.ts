// Runs the end-to-end tests against a production build and a dedicated test
// database, so they never touch development data.
//
//   npm run test:e2e
//
// Environment:
//   DATABASE_URL       Development database URL (from .env). The tests use a
//                      sibling database with the suffix "_test".
//   E2E_DATABASE_URL   Use this database as is (CI sets it).
//   E2E_BASE_URL       Test a server that is already running at this URL
//                      instead of building and starting one. It must use the
//                      same database as the tests.
//   E2E_SKIP_BUILD=1   Reuse the existing production build.
import "dotenv/config";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client as PgClient } from "pg";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const root = path.resolve(__dirname, "..");

function testDatabaseUrl(): string {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL or E2E_DATABASE_URL");
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/_test$/, "")}_test`;
  return url.toString();
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const target = new URL(databaseUrl);
  const name = decodeURIComponent(target.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unexpected database name: ${name}`);

  const admin = new URL(databaseUrl);
  admin.pathname = "/postgres";
  const client = new PgClient({ connectionString: admin.toString() });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

async function waitForServer(baseUrl: string, server?: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) throw new Error("The server exited before it was ready");
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`The server at ${baseUrl} did not become healthy within 60 seconds`);
}

async function main(): Promise<number> {
  const databaseUrl = testDatabaseUrl();
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl, ALLOWED_ORIGINS: "https://frontend.example" };

  await ensureDatabase(databaseUrl);
  run("npx", ["prisma", "migrate", "deploy"], env);
  run("npx", ["prisma", "db", "seed"], env);

  let server: ChildProcess | undefined;
  let baseUrl = process.env.E2E_BASE_URL;

  if (!baseUrl) {
    const built = existsSync(path.join(root, ".next", "BUILD_ID"));
    if (!(process.env.E2E_SKIP_BUILD === "1" && built)) run("npx", ["next", "build"], env);

    baseUrl = `http://localhost:${PORT}`;
    server = spawn("npx", ["next", "start", "--port", String(PORT)], {
      cwd: root,
      env: { ...env, NODE_ENV: "production" },
      stdio: ["ignore", "ignore", "inherit"],
    });
  }

  try {
    await waitForServer(baseUrl, server);
    const files = readdirSync(path.join(root, "tests", "e2e"))
      .filter((file) => file.endsWith(".test.ts"))
      .sort()
      .map((file) => path.join("tests", "e2e", file));

    // One file at a time: the tests share one database and its rate limits.
    const result = spawnSync("npx", ["tsx", "--test", "--test-concurrency=1", ...files], {
      cwd: root,
      env: { ...env, E2E_BASE_URL: baseUrl },
      stdio: "inherit",
    });
    return result.status ?? 1;
  } finally {
    server?.kill("SIGTERM");
  }
}

main()
  .then((status) => process.exit(status))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
