import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, resourceId, route } from "@/server/http/route";
import { scratchpadSchema } from "@/server/modules/attempts/schemas";
import { saveScratchpad } from "@/server/modules/attempts/service";

type Context = { params: Promise<{ id: string }> };

export const PUT = route<Context>(async (request, { params }) => {
  const actor = await requireRole("CANDIDATE", "EXAMINER");
  const { id } = await params;
  const input = scratchpadSchema.parse(await readJson(request));
  return ok(await saveScratchpad(actor, resourceId(id), input.text));
});
