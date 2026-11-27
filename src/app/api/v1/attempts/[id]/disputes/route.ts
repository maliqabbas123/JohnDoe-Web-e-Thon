import { requireRole } from "@/server/auth/guards";
import { created } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { DISPUTE_BODY_LIMIT, raiseDisputeSchema } from "@/server/modules/disputes/schemas";
import { raiseDispute } from "@/server/modules/disputes/service";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const user = await requireRole("CANDIDATE");
  const input = raiseDisputeSchema.parse(await readJson(request, DISPUTE_BODY_LIMIT));
  return created(await raiseDispute(user.id, resourceId((await params).id), input));
});
