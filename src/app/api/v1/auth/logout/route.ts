import { requireUser } from "@/server/auth/guards";
import { clearSessionCookie } from "@/server/auth/session";
import { noContent } from "@/server/http/response";
import { route } from "@/server/http/route";
import { logout } from "@/server/modules/auth/service";
import { clientInfo } from "@/server/security/client";

export const POST = route(async (request) => {
  const user = await requireUser();
  await logout(user, clientInfo(request));
  await clearSessionCookie();
  return noContent();
});
