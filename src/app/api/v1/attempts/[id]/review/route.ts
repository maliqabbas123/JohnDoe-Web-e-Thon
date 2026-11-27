import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { reviewAttempt } from "@/server/modules/grading/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  return ok(await reviewAttempt(examiner, resourceId((await params).id)));
});
