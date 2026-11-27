import { z } from "zod";

export const integrityQuery = z.strictObject({
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const integrityReviewSchema = z.strictObject({
  note: z.string().trim().min(1).max(2000).refine((note) => note.isWellFormed(), "Use valid Unicode text."),
});
