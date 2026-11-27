import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { listGradingQueueSchema } from "@/server/modules/grading/schemas";
import { listGradingQueue } from "@/server/modules/grading/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const filters = listGradingQueueSchema.parse(readQuery(request));
  const { items, meta } = await listGradingQueue(examiner, id, filters);
  return cursorPage(items, meta);
});
