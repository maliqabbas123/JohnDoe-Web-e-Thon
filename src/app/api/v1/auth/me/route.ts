import { requireUser } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { route } from "@/server/http/route";

export const GET = route(async () => {
  const { id, email, name, role } = await requireUser();
  return ok({ id, email, name, role });
});
