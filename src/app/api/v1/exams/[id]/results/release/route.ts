import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { releaseExamResults } from "@/server/modules/results/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  return ok(await releaseExamResults(examiner.id, id, clientInfo(request).ip));
});
