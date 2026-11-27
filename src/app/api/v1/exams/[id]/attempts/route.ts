import { requireRole } from "@/server/auth/guards";
import { created, ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { startAttemptSchema } from "@/server/modules/attempts/schemas";
import { startAttempt } from "@/server/modules/attempts/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const candidate = await requireRole("CANDIDATE");
  const id = resourceId((await params).id);
  startAttemptSchema.parse(await readJson(request));
  const { started, data } = await startAttempt(candidate, id, clientInfo(request));
  return started ? created(data) : ok(data);
});
