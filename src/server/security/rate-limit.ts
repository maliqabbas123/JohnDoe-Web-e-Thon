import "server-only";
import { db } from "../db";
import { errors } from "../http/errors";

type Limit = { limit: number; windowSeconds: number };

// Sign-in attempts for one account from one address.
export const SIGN_IN_ACCOUNT_LIMIT: Limit = { limit: 5, windowSeconds: 15 * 60 };
export const signInAccountKey = (address: string, email: string) => `login:${address}:${email}`;

const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");
// Matches the account's counter for every address. The address-only counter
// ("login:<address>") has no email suffix and is never matched.
const signInKeyPattern = (email: string) => `login:%:${escapeLike(email)}`;

// When the account is locked out of sign-in, the time the lock ends.
export async function signInLockedUntil(email: string): Promise<Date | null> {
  const rows = await db.$queryRaw<{ until: Date }[]>`
    SELECT max("resetAt") AS "until"
    FROM "RateLimit"
    WHERE "key" LIKE ${signInKeyPattern(email)}
      AND "count" >= ${SIGN_IN_ACCOUNT_LIMIT.limit}
      AND "resetAt" > now()
  `;
  return rows[0]?.until ?? null;
}

export async function clearSignInLock(email: string): Promise<number> {
  return db.$executeRaw`DELETE FROM "RateLimit" WHERE "key" LIKE ${signInKeyPattern(email)}`;
}

// Fixed-window counter in PostgreSQL. One atomic statement increments the
// counter or starts a new window, so the limit holds across concurrent
// requests and across serverless instances.
export async function consumeRateLimit(key: string, { limit, windowSeconds }: Limit): Promise<void> {
  const rows = await db.$queryRaw<{ count: number; retryAfter: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt")
    VALUES (${key}, 1, now() + make_interval(secs => ${windowSeconds}::double precision))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= now() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE
        WHEN "RateLimit"."resetAt" <= now()
        THEN now() + make_interval(secs => ${windowSeconds}::double precision)
        ELSE "RateLimit"."resetAt"
      END
    RETURNING "count", EXTRACT(EPOCH FROM ("resetAt" - now()))::double precision AS "retryAfter"
  `;

  // Roughly one call in fifty also removes counters whose window ended over
  // an hour ago, so the table does not grow with every address ever seen.
  if (Math.random() < 0.02) {
    await db.$executeRaw`DELETE FROM "RateLimit" WHERE "resetAt" < now() - interval '1 hour'`;
  }

  const state = rows[0];
  if (state && state.count > limit) {
    throw errors.rateLimited(state.retryAfter);
  }
}

export async function clearRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}
