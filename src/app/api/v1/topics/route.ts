import { requireRole } from "@/server/auth/guards";
import { created, ok } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { createTopicSchema } from "@/server/modules/questions/schemas";
import { createTopic, listTopics } from "@/server/modules/questions/service";

export const GET = route(async () => {
  const examiner = await requireRole("EXAMINER");
  return ok(await listTopics(examiner));
});

export const POST = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const input = createTopicSchema.parse(await readJson(request));
  return created(await createTopic(examiner, input));
});
