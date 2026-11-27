import { z } from "zod";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const cursorPosition = z.tuple([z.iso.datetime(), identifier]);
const announcementCursor = z.string().min(1).max(200).transform((value, context) => {
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") === value) {
      const position = cursorPosition.safeParse(JSON.parse(bytes.toString("utf8")));
      if (position.success) return { createdAt: new Date(position.data[0]), id: position.data[1] };
    }
  } catch {
    // Invalid cursor data is a query validation error.
  }
  context.addIssue({ code: "custom", message: "Use the announcement cursor returned by the server." });
  return z.NEVER;
});

export const heartbeatQuery = z.strictObject({ cursor: announcementCursor.optional() });
export const announcementListQuery = z.strictObject({
  cursor: announcementCursor.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export const monitorQuery = z.strictObject({
  cursor: identifier.optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});
export const createAnnouncementSchema = z.strictObject({
  message: z.string().trim().min(1).max(1000),
});

const awayDetails = z.strictObject({ awayMs: z.number().int().min(0).max(86_400_000) });
const positionDetails = z.strictObject({ position: z.number().int().min(1).max(2_147_483_647) });
const shortcutDetails = z.strictObject({
  key: z.enum(["F12", "Ctrl+Shift+I", "Ctrl+Shift+J", "Ctrl+Shift+C", "Meta+Alt+I", "Meta+Alt+J", "Meta+Alt+C"]),
});
const incident = z.discriminatedUnion("type", [
  z.strictObject({ type: z.enum(["TAB_HIDDEN", "FOCUS_LOST"]), details: awayDetails.optional() }),
  z.strictObject({ type: z.enum(["COPY_ATTEMPT", "PASTE_ATTEMPT"]), details: positionDetails }),
  z.strictObject({ type: z.literal("DEVTOOLS_SHORTCUT"), details: shortcutDetails }),
  z.strictObject({ type: z.enum(["FULLSCREEN_EXIT", "CONTEXT_MENU", "PRINT_SCREEN", "EXTRA_DISPLAY"]) }),
]);
export const incidentBatchSchema = z.strictObject({ incidents: z.array(incident).min(1).max(20) });
export type ClientIncident = z.infer<typeof incident>;
export type AnnouncementCursor = z.infer<typeof announcementCursor>;
export type MonitorQuery = z.infer<typeof monitorQuery>;
