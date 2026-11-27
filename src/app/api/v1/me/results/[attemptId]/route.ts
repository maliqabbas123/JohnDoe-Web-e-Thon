import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { candidateResultDetail } from "@/server/modules/results/service";

type Context = { params: Promise<{ attemptId: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const user = await requireRole("CANDIDATE");
  const attemptId = resourceId((await params).attemptId);
  return ok(await candidateResultDetail(user.id, attemptId));
});
