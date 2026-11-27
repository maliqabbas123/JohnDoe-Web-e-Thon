import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { listDisputesSchema } from "@/server/modules/disputes/schemas";
import { listExamDisputes } from "@/server/modules/disputes/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const user = await requireRole("EXAMINER");
  const { items, meta } = await listExamDisputes(user.id, resourceId((await params).id), listDisputesSchema.parse(readQuery(request)));
  return cursorPage(items, meta);
});
