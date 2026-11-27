import { requireRole } from "@/server/auth/guards";
import { page } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { enrolmentPageSchema } from "@/server/modules/enrolment/schemas";
import { listCandidateExams } from "@/server/modules/enrolment/service";

export const GET = route(async (request) => {
  const candidate = await requireRole("CANDIDATE");
  const pagination = enrolmentPageSchema.parse(readQuery(request));
  const { items, meta } = await listCandidateExams(candidate, pagination);
  return page(items, meta);
});
