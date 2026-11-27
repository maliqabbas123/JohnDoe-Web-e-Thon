import { db } from "@/server/db";
import { ApiError } from "@/server/http/errors";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";

// Liveness check: confirms the server can reach the database. The cause of a
// failure is logged, never returned.
export const GET = route(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("Health check failed", error);
    throw new ApiError(503, "INTERNAL", "The database is not reachable.");
  }
  return ok({ status: "ok", database: "up", serverTime: new Date().toISOString() });
});
