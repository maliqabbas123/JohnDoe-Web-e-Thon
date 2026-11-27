import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { listResultsSchema } from "@/server/modules/results/schemas";
import { listExamResults } from "@/server/modules/results/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const user = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = listResultsSchema.parse(readQuery(request));
  const { items, meta } = await listExamResults(user.id, id, input);
  return cursorPage(items, meta);
});
