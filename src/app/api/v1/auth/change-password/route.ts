import { requireUser } from "@/server/auth/guards";
import { noContent } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { changePasswordSchema } from "@/server/modules/auth/schemas";
import { changePassword } from "@/server/modules/auth/service";
import { clientInfo } from "@/server/security/client";

export const POST = route(async (request) => {
  const user = await requireUser();
  const input = changePasswordSchema.parse(await readJson(request));
  await changePassword(user, input, clientInfo(request));
  return noContent();
});
