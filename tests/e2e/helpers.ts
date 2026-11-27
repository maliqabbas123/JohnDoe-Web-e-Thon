// Shared tools for the end-to-end tests. The tests talk to a running server
// over HTTP exactly as a browser would, and use a direct database connection
// only to arrange state and to check what was stored.
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { TEST_ACCOUNTS, type TestAccountName } from "../../prisma/test-accounts";

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
const API = `${BASE_URL}/api/v1`;

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must point at the test database");
const pool = new Pool({ connectionString: databaseUrl, max: 4 });

export async function sql<Row = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<Row[]> {
  return (await pool.query(text, params)).rows as Row[];
}

export async function scalar<Value = number>(text: string, params: unknown[] = []): Promise<Value> {
  const rows = await sql<Record<string, Value>>(text, params);
  return Object.values(rows[0])[0];
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

// Rate limits are real in the test environment, so each test starts with a
// clean slate instead of the limits being switched off.
export async function resetRateLimits(): Promise<void> {
  await sql('DELETE FROM "RateLimit"');
}

// Every account a test creates uses this prefix, so it can be removed again.
const TEMP_PREFIX = "e2e-";
export function tempEmail(label = "user"): string {
  return `${TEMP_PREFIX}${label}-${randomBytes(5).toString("hex")}@exam.test`;
}

export async function removeTempUsers(): Promise<void> {
  await sql(`DELETE FROM "User" WHERE email LIKE $1`, [`${TEMP_PREFIX}%`]);
}

export type ApiResponse = {
  status: number;
  headers: Headers;
  // Parsed JSON body, or null when the response has none.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  text: string;
  setCookie: string[];
};

type RequestOptions = {
  json?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

// A minimal browser stand-in: it keeps cookies between requests and sends
// them back, including ones marked Secure, so it works over plain HTTP.
export class Client {
  private readonly cookies = new Map<string, string>();

  async request(method: string, path: string, options: RequestOptions = {}): Promise<ApiResponse> {
    const headers: Record<string, string> = { ...options.headers };
    let body: string | undefined;
    if (options.json !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = JSON.stringify(options.json);
    } else if (options.rawBody !== undefined) {
      headers["Content-Type"] ??= "application/json";
      body = options.rawBody;
    }
    if (this.cookies.size > 0 && headers.Cookie === undefined) {
      headers.Cookie = [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
    }

    const url = path.startsWith("http") ? path : `${API}${path}`;
    const response = await fetch(url, { method, headers, body, redirect: "manual" });
    const setCookie = response.headers.getSetCookie();
    for (const cookie of setCookie) this.store(cookie);

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    return { status: response.status, headers: response.headers, body: parsed, text, setCookie };
  }

  get = (path: string, options?: RequestOptions) => this.request("GET", path, options);
  post = (path: string, json?: unknown, options?: RequestOptions) =>
    this.request("POST", path, { ...options, json });
  patch = (path: string, json?: unknown, options?: RequestOptions) =>
    this.request("PATCH", path, { ...options, json });
  delete = (path: string, options?: RequestOptions) => this.request("DELETE", path, options);

  cookie(name: string): string | undefined {
    return this.cookies.get(name);
  }

  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  private store(header: string): void {
    const [pair, ...attributes] = header.split(";").map((part) => part.trim());
    const separator = pair.indexOf("=");
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    const expired = attributes.some((attribute) => {
      const [key, attributeValue] = attribute.split("=");
      if (key.toLowerCase() === "max-age") return Number(attributeValue) <= 0;
      if (key.toLowerCase() === "expires") return new Date(attributeValue).getTime() <= Date.now();
      return false;
    });
    if (expired || value === "") this.cookies.delete(name);
    else this.cookies.set(name, value);
  }
}

export async function signIn(email: string, password: string): Promise<Client> {
  const client = new Client();
  const response = await client.post("/auth/login", { email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in as ${email} failed with ${response.status}: ${response.text}`);
  }
  return client;
}

// Signs in as one of the seeded accounts. A new sign-in ends that account's
// previous session, so do not hold two clients for the same account.
export function signInAs(account: TestAccountName): Promise<Client> {
  const { email, password } = TEST_ACCOUNTS[account];
  return signIn(email, password);
}

export type TempUser = { id: string; email: string; password: string; client: Client };

// Creates a throwaway account through the public sign-up endpoint.
export async function createTempUser(
  role: "CANDIDATE" | "EXAMINER" = "CANDIDATE",
  password = "temp-password-1",
): Promise<TempUser> {
  const client = new Client();
  const email = tempEmail(role.toLowerCase());
  const response = await client.post("/auth/signup", { email, name: "Temp User", password, role });
  if (response.status !== 201) {
    throw new Error(`Sign-up failed with ${response.status}: ${response.text}`);
  }
  // Sign-ups are limited per address; tests create many accounts.
  await resetRateLimits();
  return { id: response.body.data.user.id, email, password, client };
}

export { TEST_ACCOUNTS };
