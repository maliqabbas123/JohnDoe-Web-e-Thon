import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { updateExamSchema } from "@/server/modules/exams/schemas";
import { getExam, updateExam } from "@/server/modules/exams/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  return ok(await getExam(examiner, resourceId((await params).id)));
});

export const PATCH = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = updateExamSchema.parse(await readJson(request));
  return ok(await updateExam(examiner, id, input));
});
