import { z } from "zod";
import { emailSchema } from "@/server/modules/auth/schemas";

// 500 addresses at the maximum supported length fit in one request.
export const ENROLMENT_BODY_BYTES = 128 * 1024;

export const enrolCandidatesSchema = z.strictObject({
  emails: z.array(emailSchema).min(1).max(500),
});

export const enrolmentPageSchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const createRetakeGrantSchema = z.strictObject({
  candidateId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  startsAt: instant,
  endsAt: instant,
  reason: z.string().trim().min(1).max(2000),
  attemptsAllowed: z.number().int().min(1).max(2_147_483_647).default(1),
}).refine(({ startsAt, endsAt }) => endsAt > startsAt, {
  path: ["endsAt"],
  message: "The retake slot must end after it starts.",
});

export const joinExamSchema = z.strictObject({
  code: z.string().trim().toLowerCase(),
});

export type EnrolmentPage = z.infer<typeof enrolmentPageSchema>;
export type CreateRetakeGrantInput = z.infer<typeof createRetakeGrantSchema>;
