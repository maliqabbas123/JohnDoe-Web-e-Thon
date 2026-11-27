import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { listDisputesSchema } from "@/server/modules/disputes/schemas";
import { listCandidateDisputes } from "@/server/modules/disputes/service";

export const GET = route(async (request) => {
  const user = await requireRole("CANDIDATE");
  const { items, meta } = await listCandidateDisputes(user.id, listDisputesSchema.parse(readQuery(request)));
  return cursorPage(items, meta);
});
