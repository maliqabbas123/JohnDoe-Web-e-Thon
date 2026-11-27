import { requireRole } from "@/server/auth/guards";
import { noContent } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { revokeSessions } from "@/server/modules/users/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

// Force sign-out: ends every session of the user.
export const DELETE = route<Context>(async (request, { params }) => {
  const admin = await requireRole("ADMIN");
  await revokeSessions(admin, resourceId((await params).id), clientInfo(request));
  return noContent();
});
