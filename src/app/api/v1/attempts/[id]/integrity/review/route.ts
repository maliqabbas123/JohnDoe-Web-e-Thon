import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { integrityReviewSchema } from "@/server/modules/integrity/schemas";
import { reviewIntegrity } from "@/server/modules/integrity/service";

type Context = { params: Promise<{ id: string }> };

export const PUT = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const { note } = integrityReviewSchema.parse(await readJson(request));
  return ok(await reviewIntegrity(id, examiner.id, note));
});
