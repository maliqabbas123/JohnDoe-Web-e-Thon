import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, resourceId, route } from "@/server/http/route";
import { getExamMonitor } from "@/server/modules/monitoring/monitor";
import { monitorQuery } from "@/server/modules/monitoring/schemas";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const page = await getExamMonitor(id, examiner.id, monitorQuery.parse(readQuery(request)));
  const meta = { ...page.meta, serverTime: page.serverTime };
  return cursorPage(page.items, meta);
});
