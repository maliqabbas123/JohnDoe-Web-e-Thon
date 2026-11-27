import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { integrityQuery } from "@/server/modules/integrity/schemas";
import { getIntegrity } from "@/server/modules/integrity/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const { pageSize, cursor } = integrityQuery.parse(readQuery(request));
  return ok(await getIntegrity(id, examiner.id, pageSize, cursor));
});
