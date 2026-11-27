import { requireRole } from "@/server/auth/guards";
import { created, noContent, ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { resetSandbox, startSandbox } from "@/server/modules/attempts/service";
import { clientInfo } from "@/server/security/client";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const { started, data } = await startSandbox(examiner, resourceId((await params).id), clientInfo(request));
  return started ? created(data) : ok(data);
});

export const DELETE = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  await resetSandbox(examiner, resourceId((await params).id));
  return noContent();
});
