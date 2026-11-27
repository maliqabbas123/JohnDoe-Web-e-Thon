import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { gradeAnswerSchema, gradePositionSchema } from "@/server/modules/grading/schemas";
import { gradeAnswer } from "@/server/modules/grading/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string; position: string }> };

export const PATCH = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const { id, position } = await params;
  const attemptId = resourceId(id);
  const questionPosition = gradePositionSchema.parse(position);
  const input = gradeAnswerSchema.parse(await readJson(request));
  return ok(await gradeAnswer(examiner, attemptId, questionPosition, input, clientInfo(request).ip));
});
