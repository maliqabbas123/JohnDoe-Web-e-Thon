import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { questionPoolSchema } from "@/server/modules/exams/schemas";
import { replaceQuestionPool } from "@/server/modules/exams/service";

type Context = { params: Promise<{ id: string }> };

export const PUT = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = questionPoolSchema.parse(await readJson(request));
  return ok(await replaceQuestionPool(examiner, id, input));
});
