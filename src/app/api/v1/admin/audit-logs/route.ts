import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { listAuditLogsSchema } from "@/server/modules/admin/schemas";
import { listAuditLogs } from "@/server/modules/admin/service";

export const GET = route(async (request) => {
  await requireRole("ADMIN");
  const filters = listAuditLogsSchema.parse(readQuery(request));
  const { items, meta } = await listAuditLogs(filters);
  return cursorPage(items, meta);
});
