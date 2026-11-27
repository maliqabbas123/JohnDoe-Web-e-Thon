import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { getUserActivity } from "@/server/modules/users/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  await requireRole("ADMIN");
  return ok(await getUserActivity(resourceId((await params).id)));
});
