import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { myResultsSchema } from "@/server/modules/results/schemas";
import { listCandidateResults } from "@/server/modules/results/service";

export const GET = route(async (request) => {
  const user = await requireRole("CANDIDATE");
  const input = myResultsSchema.parse(readQuery(request));
  const { items, meta } = await listCandidateResults(user.id, input);
  return cursorPage(items, meta);
});
