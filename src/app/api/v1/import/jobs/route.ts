import { requireRole } from "@/server/auth/guards";
import { cursorPage } from "@/server/http/response";
import { readQuery, route } from "@/server/http/route";
import { importJobsQuerySchema } from "@/server/modules/import/schemas";
import { listImportJobs } from "@/server/modules/import/service";

export const GET = route(async (request) => {
  const examiner = await requireRole("EXAMINER");
  const filters = importJobsQuerySchema.parse(readQuery(request));
  const { items, meta } = await listImportJobs(examiner, filters);
  return cursorPage(items, meta);
});
