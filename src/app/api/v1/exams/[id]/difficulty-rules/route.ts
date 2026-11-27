import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { difficultyRulesSchema } from "@/server/modules/exams/schemas";
import { replaceDifficultyRules } from "@/server/modules/exams/service";

type Context = { params: Promise<{ id: string }> };

export const PUT = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = difficultyRulesSchema.parse(await readJson(request));
  return ok(await replaceDifficultyRules(examiner, id, input));
});
