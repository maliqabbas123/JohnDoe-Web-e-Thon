import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { getCandidateExam } from "@/server/modules/enrolment/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const candidate = await requireRole("CANDIDATE");
  return ok(await getCandidateExam(candidate, resourceId((await params).id)));
});
