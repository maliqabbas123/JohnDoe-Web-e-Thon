import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { joinExamSchema } from "@/server/modules/enrolment/schemas";
import { joinExam } from "@/server/modules/enrolment/service";

export const POST = route(async (request) => {
  const candidate = await requireRole("CANDIDATE");
  const { code } = joinExamSchema.parse(await readJson(request));
  return ok(await joinExam(candidate, code));
});
