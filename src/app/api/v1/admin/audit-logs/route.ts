import { requireRole } from "@/server/auth/guards";
import { page } from "@/server/http/response";
import { route } from "@/server/http/route";
import { listAuditLogsSchema } from "@/server/modules/admin/schemas";
import { listAuditLogs } from "@/server/modules/admin/service";

export const GET = route(async (request) => {
  await requireRole("ADMIN");
  const filters = listAuditLogsSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const { items, meta } = await listAuditLogs(filters);
  return page(items, meta);
});
