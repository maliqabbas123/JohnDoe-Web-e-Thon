import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";
import { getPlatformOverview } from "@/server/modules/admin/service";

export const GET = route(async () => {
  await requireRole("ADMIN");
  return ok(await getPlatformOverview());
});
