import "server-only";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { storedWorkspacePreferencesSchema, type WorkspacePreferences } from "./schemas";

export async function getWorkspacePreferences(candidate: SessionUser): Promise<WorkspacePreferences> {
  const row = await db.userPreference.findUnique({
    where: { userId: candidate.id },
    select: { workspace: true },
  });
  return storedWorkspacePreferencesSchema.parse(row?.workspace);
}

export async function saveWorkspacePreferences(
  candidate: SessionUser,
  workspace: WorkspacePreferences,
): Promise<WorkspacePreferences> {
  await db.userPreference.upsert({
    where: { userId: candidate.id },
    create: { userId: candidate.id, workspace },
    update: { workspace },
    select: { userId: true },
  });
  return workspace;
}
