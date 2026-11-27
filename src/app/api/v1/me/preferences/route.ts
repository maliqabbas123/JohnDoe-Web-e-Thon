import { requireRole } from "@/server/auth/guards";
import { ok } from "@/server/http/response";
import { readJson, route } from "@/server/http/route";
import { workspacePreferencesSchema } from "@/server/modules/workspace/schemas";
import { getWorkspacePreferences, saveWorkspacePreferences } from "@/server/modules/workspace/service";

export const GET = route(async () => {
  const candidate = await requireRole("CANDIDATE");
  return ok(await getWorkspacePreferences(candidate));
});

export const PUT = route(async (request) => {
  const candidate = await requireRole("CANDIDATE");
  const workspace = workspacePreferencesSchema.parse(await readJson(request));
  return ok(await saveWorkspacePreferences(candidate, workspace));
});
