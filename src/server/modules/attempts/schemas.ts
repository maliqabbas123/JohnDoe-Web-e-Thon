import { z } from "zod";
import { errors } from "@/server/http/errors";

const MAX_INT = 2_147_483_647;

export const startAttemptSchema = z.strictObject({ rulesAccepted: z.literal(true) });

export const saveAnswerSchema = z.strictObject({
  revision: z.number().int().min(1).max(MAX_INT),
  selectedOptionIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).max(10).optional(),
  writtenAnswer: z.string().max(10_000).nullable().optional(),
  flagged: z.boolean().optional(),
  keystrokeCount: z.number().int().min(0).max(MAX_INT).optional(),
  pasteCount: z.number().int().min(0).max(MAX_INT).optional(),
}).refine(
  ({ selectedOptionIds }) => !selectedOptionIds || new Set(selectedOptionIds).size === selectedOptionIds.length,
  { path: ["selectedOptionIds"], message: "Select each option at most once." },
).refine(({ revision, ...changes }) => revision > 0 && Object.keys(changes).length > 0, {
  message: "Send at least one change with the revision.",
});

export const scratchpadSchema = z.strictObject({ text: z.string().max(10_000) });

export function questionPosition(value: string) {
  if (!/^[1-9][0-9]{0,2}$/.test(value)) throw errors.notFound("Question not found.");
  return Number(value);
}

export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;
