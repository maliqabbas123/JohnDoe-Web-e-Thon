import { requireRole } from "@/server/auth/guards";
import { noContent, ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { updateTopicSchema } from "@/server/modules/questions/schemas";
import { deleteTopic, renameTopic } from "@/server/modules/questions/service";

type Context = { params: Promise<{ id: string }> };

export const PATCH = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = updateTopicSchema.parse(await readJson(request));
  return ok(await renameTopic(examiner, id, input));
});

export const DELETE = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  await deleteTopic(examiner, resourceId((await params).id));
  return noContent();
});
