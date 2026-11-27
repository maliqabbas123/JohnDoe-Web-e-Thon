import { requireRole } from "@/server/auth/guards";
import { noContent } from "@/server/http/response";
import { resourceId, route } from "@/server/http/route";
import { removeEnrolment } from "@/server/modules/enrolment/service";

type Context = { params: Promise<{ id: string; candidateId: string }> };

export const DELETE = route<Context>(async (_request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const { id, candidateId } = await params;
  await removeEnrolment(examiner, resourceId(id), resourceId(candidateId));
  return noContent();
});
