import { requireRole } from "@/server/auth/guards";
import { created, page } from "@/server/http/response";
import { readJson, readQuery, route } from "@/server/http/route";
import { createExamSchema, listExamsSchema } from "@/server/modules/exams/schemas";
import { createExam, listExams } from "@/server/modules/exams/service";

export const GET = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const input = listExamsSchema.parse(readQuery(request));
  const { items, meta } = await listExams(examiner, input);
  return page(items, meta);
});

export const POST = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const input = createExamSchema.parse(await readJson(request));
  return created(await createExam(examiner, input));
});
