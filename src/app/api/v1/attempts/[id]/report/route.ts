import { requireRole } from "@/server/auth/guards";
import { created, ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { issueReport } from "@/server/modules/reports/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const result = await issueReport(examiner.id, resourceId((await params).id), request.nextUrl.origin, clientInfo(request).ip);
  return result.created ? created(result.report) : ok(result.report);
});
