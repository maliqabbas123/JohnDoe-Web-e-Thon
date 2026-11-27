import "server-only";
import { db } from "../db";
import { errors } from "../http/errors";

type Limit = { limit: number; windowSeconds: number };

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
