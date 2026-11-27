import { setSessionCookie } from "@/server/auth/session";
import { ok } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { loginSchema } from "@/server/modules/auth/schemas";
import { login } from "@/server/modules/auth/service";
import { clientInfo } from "@/server/security/client";

export const POST = route(async (request) => {
  const input = loginSchema.parse(await readJson(request));
  const { user, token, expiresAt } = await login(input, clientInfo(request));
  await setSessionCookie(token, expiresAt);
  return ok({ user, expiresAt: expiresAt.toISOString() });
});
