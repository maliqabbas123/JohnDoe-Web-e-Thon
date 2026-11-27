import { requireRole } from "@/server/auth/guards";
import { created, page } from "@/server/http/response";
import { readJson, readQuery, route } from "@/server/http/route";
import { createQuestionSchema, listQuestionsSchema } from "@/server/modules/questions/schemas";
import { createQuestion, listQuestions } from "@/server/modules/questions/service";

export const GET = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const filters = listQuestionsSchema.parse(readQuery(request));
  const { items, meta } = await listQuestions(examiner, filters);
  return page(items, meta);
});

export const POST = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const input = createQuestionSchema.parse(await readJson(request));
  return created(await createQuestion(examiner, input));
});
