import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { questionPosition } from "@/server/modules/attempts/schemas";
import { getAttemptQuestion } from "@/server/modules/attempts/service";

type Context = { params: Promise<{ id: string; position: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const actor = await requireRole("CANDIDATE", "EXAMINER");
  const { id, position } = await params;
  return ok(await getAttemptQuestion(actor, resourceId(id), questionPosition(position)));
});
