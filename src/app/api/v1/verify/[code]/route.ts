import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { verifyReport } from "@/server/modules/reports/service";
import { clientInfo } from "@/server/security/client";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Context = { params: Promise<{ code: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const code = resourceId((await params).code);
  await consumeRateLimit(`report-verify:${clientInfo(request).ip ?? "unknown"}`, { limit: 60, windowSeconds: 60 });
  return ok(await verifyReport(code));
});
