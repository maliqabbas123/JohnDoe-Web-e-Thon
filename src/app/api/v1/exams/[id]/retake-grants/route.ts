import { requireRole } from "@/server/auth/guards";
import { created, page } from "@/server/http/response";
import { readJson, readQuery, resourceId, route } from "@/server/http/route";
import { createRetakeGrantSchema, enrolmentPageSchema } from "@/server/modules/enrolment/schemas";
import { createRetakeGrant, listRetakeGrants } from "@/server/modules/enrolment/service";

type Context = { params: Promise<{ id: string }> };

export const GET = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const pagination = enrolmentPageSchema.parse(readQuery(request));
  const { items, meta } = await listRetakeGrants(examiner, id, pagination);
  return page(items, meta);
});

export const POST = route<Context>(async (request, { params }) => {
  const examiner = await requireRole("EXAMINER");
  const id = resourceId((await params).id);
  const input = createRetakeGrantSchema.parse(await readJson(request));
  return created(await createRetakeGrant(examiner, id, input));
});
