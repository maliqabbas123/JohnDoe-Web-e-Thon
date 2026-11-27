import { requireRole } from "@/server/auth/guards";
import { noContent } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { unlockSignIn } from "@/server/modules/users/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

// Lifts a lockout caused by repeated failed sign-ins.
export const DELETE = route<Context>(async (request, { params }) => {
  const admin = await requireRole("ADMIN");
  await unlockSignIn(admin, resourceId((await params).id), clientInfo(request));
  return noContent();
});
