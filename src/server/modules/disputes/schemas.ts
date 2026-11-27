import { z } from "zod";

const position = z.int().min(1).max(2_147_483_647);
const category = z.enum(["GRADING_ERROR", "FAULTY_QUESTION", "TECHNICAL_INCIDENT"]);
const reason = z.string().trim().min(1).max(2000);
const optionId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const ATTACHMENT_LIMIT = 4 * 1024 * 1024;
export const DISPUTE_BODY_LIMIT = Math.ceil(ATTACHMENT_LIMIT / 3) * 4 + 64 * 1024;

export const raiseDisputeSchema = z.strictObject({
  category,
  explanation: z.string().trim().min(1).max(5000),
  positions: z.array(position).max(200).default([]),
  attachment: z.strictObject({ fileName: z.string().trim().min(1).max(200), contentBase64: z.string().min(4).refine((value) => value.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(value), "Use standard base64.") }).optional(),
}).superRefine(({ category, positions }, ctx) => {
  if (new Set(positions).size !== positions.length) {
    ctx.addIssue({ code: "custom", path: ["positions"], message: "Choose each position once." });
  }
  if (category === "TECHNICAL_INCIDENT" ? positions.length !== 0 : positions.length === 0) {
    ctx.addIssue({
      code: "custom", path: ["positions"],
      message: "A technical incident covers the whole attempt. For other categories, select at least one question.",
    });
  }
});

export const listDisputesSchema = z.strictObject({
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
});

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const score = z.number().min(0).max(99_999.99)
  .refine((value) => Math.round(value * 100) / 100 === value, "Use at most two decimal places.");

export const decideItemSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("REJECT"), reason }),
  z.strictObject({ action: z.literal("REGRADE"), reason, score }),
  z.strictObject({
    action: z.literal("ACCEPT_ALTERNATIVE"), reason,
    optionIds: z.array(optionId).min(1).max(10).refine((ids) => new Set(ids).size === ids.length, "Use each option once."),
  }),
  z.strictObject({ action: z.literal("VOID_QUESTION"), reason }),
  z.strictObject({
    action: z.literal("GRANT_RETAKE"), reason, startsAt: instant, endsAt: instant,
    attemptsAllowed: z.int().min(1).max(100).default(1),
  }),
]);

export type RaiseDisputeInput = z.infer<typeof raiseDisputeSchema>;
export type ListDisputesInput = z.infer<typeof listDisputesSchema>;
export type DecideItemInput = z.infer<typeof decideItemSchema>;
