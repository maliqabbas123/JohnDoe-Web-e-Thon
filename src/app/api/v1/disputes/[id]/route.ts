import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { examinerDispute } from "@/server/modules/disputes/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  const user = await requireRole("EXAMINER");
  return ok(await examinerDispute(user.id, resourceId((await params).id)));
});
