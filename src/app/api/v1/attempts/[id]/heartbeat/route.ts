import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { heartbeat } from "@/server/modules/monitoring/contact";
import { heartbeatQuery } from "@/server/modules/monitoring/schemas";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const candidate = await requireRole("CANDIDATE");
  const id = resourceId((await params).id);
  const { cursor } = heartbeatQuery.parse(readQuery(request));
  return ok(await heartbeat(id, candidate.id, cursor));
});
