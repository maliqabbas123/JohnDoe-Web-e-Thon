import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { updateUserSchema } from "@/server/modules/users/schemas";
import { getUser, updateUser } from "@/server/modules/users/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (_request, { params }) => {
  await requireRole("ADMIN");
  return ok(await getUser(resourceId((await params).id)));
});

export const PATCH = route<Context>(async (request, { params }) => {
  const admin = await requireRole("ADMIN");
  const id = resourceId((await params).id);
  const input = updateUserSchema.parse(await readJson(request));
  return ok(await updateUser(admin, id, input, clientInfo(request)));
});
