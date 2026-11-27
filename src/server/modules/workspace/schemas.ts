import { z } from "zod";

const fields = {
  theme: z.enum(["system", "light", "dark"]).default("system"),
  fontSize: z.number().int().min(12).max(32).default(16),
  lineSpacing: z.number().min(1).max(2).multipleOf(0.25).default(1.5),
  palettePosition: z.enum(["left", "right"]).default("right"),
};

export const workspacePreferencesSchema = z.strictObject(fields);
export type WorkspacePreferences = z.infer<typeof workspacePreferencesSchema>;

const defaults = workspacePreferencesSchema.parse({});

// Older rows may be empty or store obsolete fields in this JSON column.
export const storedWorkspacePreferencesSchema = z.object({
  theme: fields.theme.catch(defaults.theme),
  fontSize: fields.fontSize.catch(defaults.fontSize),
  lineSpacing: fields.lineSpacing.catch(defaults.lineSpacing),
  palettePosition: fields.palettePosition.catch(defaults.palettePosition),
}).catch(defaults);
