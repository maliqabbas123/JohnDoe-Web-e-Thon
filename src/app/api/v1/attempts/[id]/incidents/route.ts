import { requireRole } from "@/server/auth/guards";
import { created } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { recordClientIncidents } from "@/server/modules/monitoring/incidents";
import { incidentBatchSchema } from "@/server/modules/monitoring/schemas";
import { consumeRateLimit } from "@/server/security/rate-limit";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const candidate = await requireRole("CANDIDATE");
  const id = resourceId((await params).id);
  await consumeRateLimit("incidents:" + candidate.id, { limit: 12, windowSeconds: 60 });
  const { incidents } = incidentBatchSchema.parse(await readJson(request));
  return created(await recordClientIncidents(id, candidate.id, incidents));
});
