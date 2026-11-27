import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { updateQuestionSchema } from "@/server/modules/questions/schemas";
import { getQuestion, removeQuestion, updateQuestion } from "@/server/modules/questions/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  return ok(await getQuestion(examiner, resourceId((await params).id)));
});

export const PATCH = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = updateQuestionSchema.parse(await readJson(request));
  return ok(await updateQuestion(examiner, id, input));
});

// Deletes a question that was never used; archives one that was.
export const DELETE = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  return ok(await removeQuestion(examiner, resourceId((await params).id)));
});
