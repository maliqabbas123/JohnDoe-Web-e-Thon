import { setSessionCookie } from "@/server/auth/session";
import { created } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { signupSchema } from "@/server/modules/auth/schemas";
import { signup } from "@/server/modules/auth/service";
import { clientInfo } from "@/server/security/client";

// Registers a candidate or examiner and signs them in.
export const POST = route(async (request) => {
  const input = signupSchema.parse(await readJson(request));
  const { user, token, expiresAt } = await signup(input, clientInfo(request));
  await setSessionCookie(token, expiresAt);
  return created({ user, expiresAt: expiresAt.toISOString() });
});
