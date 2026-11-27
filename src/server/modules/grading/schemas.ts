import { z } from "zod";

const cursorPosition = z.tuple([
  z.iso.datetime().transform((value) => new Date(value)),
  z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
]);

const queueCursor = z.string().max(200).regex(/^[A-Za-z0-9_-]+$/).transform((value, ctx) => {
  try {
    return cursorPosition.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
  } catch {
    ctx.addIssue({ code: "custom", message: "The cursor is not valid." });
    return z.NEVER;
  }
});

export const listGradingQueueSchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: queueCursor.optional(),
});

export const gradePositionSchema = z
  .string()
  .regex(/^[1-9]\d{0,9}$/, "Use a positive question position.")
  .transform(Number)
  .pipe(z.int().max(2_147_483_647));

export const gradeAnswerSchema = z.strictObject({
  score: z
    .number()
    .min(0)
    .max(99_999.99)
    .refine((value) => Math.round(value * 100) / 100 === value, "Use at most two decimal places."),
  feedback: z.string().trim().max(5000).nullable().optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
});

export type ListGradingQueueInput = z.infer<typeof listGradingQueueSchema>;
export type GradeAnswerInput = z.infer<typeof gradeAnswerSchema>;
