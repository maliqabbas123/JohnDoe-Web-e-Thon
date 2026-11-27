import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const pageSize = z.coerce.number().int().min(1).max(100).default(20);

export const listResultsSchema = z.strictObject({ pageSize, cursor: id.optional() });

const releasePosition = z.tuple([z.iso.datetime().transform((value) => new Date(value)), id]);

export const myResultsSchema = z.strictObject({
  pageSize,
  cursor: z.string().max(200).regex(/^[A-Za-z0-9_-]+$/).transform((value, context) => {
    try {
      return releasePosition.parse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    } catch {
      context.addIssue({ code: "custom", message: "The cursor is not valid." });
      return z.NEVER;
    }
  }).optional(),
});

export type ListResultsInput = z.infer<typeof listResultsSchema>;
export type MyResultsInput = z.infer<typeof myResultsSchema>;
