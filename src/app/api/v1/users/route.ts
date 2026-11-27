import { requireRole } from "@/server/auth/guards";
import { created, page } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { createUserSchema, listUsersSchema } from "@/server/modules/users/schemas";
import { createUser, listUsers } from "@/server/modules/users/service";
import { clientInfo } from "@/server/security/client";

export const GET = route(async (request) => {
  await requireRole("ADMIN");
  const filters = listUsersSchema.parse(Object.fromEntries(request.nextUrl.searchParams));
  const { items, meta } = await listUsers(filters);
  return page(items, meta);
});

export const POST = route(async (request) => {
  const admin = await requireRole("ADMIN");
  const input = createUserSchema.parse(await readJson(request));
  return created(await createUser(admin, input, clientInfo(request)));
});
