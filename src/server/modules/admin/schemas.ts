import { z } from "zod";

// Timestamps must be full ISO 8601 with an offset, so there is no ambiguity
// about the time zone a filter refers to.
const instant = z.iso
  .datetime({ offset: true, message: "Use an ISO 8601 date and time with a time zone." })
  .transform((value) => new Date(value));

const identifier = z.string().trim().min(1).max(64);

export const listAuditLogsSchema = z
  .object({
    actorId: identifier.optional(),
    action: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z_]{1,64}$/, "Use an action name such as LOGIN_FAILED.")
      .optional(),
    entityType: identifier.optional(),
    entityId: identifier.optional(),
    from: instant.optional(),
    to: instant.optional(),
    // Opaque position returned as meta.nextCursor by the previous page.
    cursor: z.string().min(1).max(200).optional(),
    // Counting every matching entry is the slowest part of a read on a large
    // log, so the total is returned only when asked for.
    withTotal: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .default(false),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    path: ["to"],
    message: "The end of the range must not be before its start.",
  });

export type ListAuditLogsInput = z.infer<typeof listAuditLogsSchema>;
