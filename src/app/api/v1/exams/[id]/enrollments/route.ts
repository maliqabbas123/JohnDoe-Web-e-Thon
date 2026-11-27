import { requireRole } from "@/server/auth/guards";
import { ok, page } from "@/server/http/response";
import { readJson, readQuery, resourceId, route } from "@/server/http/route";
import { ENROLMENT_BODY_BYTES, enrolCandidatesSchema, enrolmentPageSchema } from "@/server/modules/enrolment/schemas";
import { enrolCandidates, listEnrolments } from "@/server/modules/enrolment/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const pagination = enrolmentPageSchema.parse(readQuery(request));
  const { items, meta } = await listEnrolments(examiner, id, pagination);
  return page(items, meta);
});

export const POST = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const { emails } = enrolCandidatesSchema.parse(await readJson(request, ENROLMENT_BODY_BYTES));
  return ok(await enrolCandidates(examiner, id, emails));
});
