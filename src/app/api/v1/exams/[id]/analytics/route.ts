import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { listResultsSchema } from "@/server/modules/results/schemas";
import { examAnalytics } from "@/server/modules/results/analytics";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const user = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = listResultsSchema.parse(readQuery(request));
  return ok(await examAnalytics(user.id, id, input));
});
