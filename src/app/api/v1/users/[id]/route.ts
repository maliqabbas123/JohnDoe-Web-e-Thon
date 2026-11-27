import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { updateUserSchema } from "@/server/modules/users/schemas";
import { getUser, updateUser } from "@/server/modules/users/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  await requireRole("ADMIN");
  return ok(await getUser((await params).id));
});

export const PATCH = route<Context>(async (request, { params }) => {
  const admin = await requireRole("ADMIN");
  const input = updateUserSchema.parse(await readJson(request));
  return ok(await updateUser(admin, (await params).id, input, clientInfo(request)));
});
