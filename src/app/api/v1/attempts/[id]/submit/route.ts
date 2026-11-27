import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { submitAttempt } from "@/server/modules/attempts/service";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (_request, { params }) => {
  const actor = await requireRole("CANDIDATE", "EXAMINER");
  const { id } = await params;
  return ok(await submitAttempt(actor, resourceId(id)));
});
