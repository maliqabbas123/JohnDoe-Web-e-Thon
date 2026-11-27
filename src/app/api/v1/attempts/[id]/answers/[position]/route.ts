import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { questionPosition, saveAnswerSchema } from "@/server/modules/attempts/schemas";
import { saveAttemptAnswer } from "@/server/modules/attempts/service";

type Context = { params: Promise<{ id: string; position: string }> };

export const PUT = route<Context>(async (request, { params }) => {
  const actor = await requireRole("CANDIDATE", "EXAMINER");
  const { id, position } = await params;
  const input = saveAnswerSchema.parse(await readJson(request));
  return ok(await saveAttemptAnswer(actor, resourceId(id), questionPosition(position), input));
});
