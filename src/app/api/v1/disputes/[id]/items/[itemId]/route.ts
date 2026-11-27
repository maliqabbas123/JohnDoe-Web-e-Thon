import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { decideItemSchema } from "@/server/modules/disputes/schemas";
import { decideDisputeItem } from "@/server/modules/disputes/service";

type Context = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const { id, itemId } = await params;
  const disputeId = resourceId(id);
  const item = resourceId(itemId);
  const input = decideItemSchema.parse(await readJson(request));
  return ok(await decideDisputeItem(examiner.id, disputeId, item, input));
});
