import { requireRole } from "@/server/auth/guards";
import { noContent, ok } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { disableJoinCode, rotateJoinCode } from "@/server/modules/exams/service";

type Context = { params: Promise<{ id: string }> };

export const POST = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  return ok(await rotateJoinCode(examiner, resourceId((await params).id)));
});

export const DELETE = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  await disableJoinCode(examiner, resourceId((await params).id));
  return noContent();
});
