import { z } from "zod";

export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORT_ROWS = 100;

export const questionImportQuerySchema = z.strictObject({
  fileName: z.string().trim().min(1).max(255).refine(
    (name) => name.isWellFormed() && !/[/\\\p{Cc}]/u.test(name),
    "Use a file name without path separators or control characters.",
  ).optional(),
});

const jobPosition = z.tuple([z.iso.datetime(), z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)]);

export const importJobsQuerySchema = z.strictObject({
  cursor: z.string().max(200).transform((cursor, context) => {
    try {
      const bytes = Buffer.from(cursor, "base64url");
      if (bytes.toString("base64url") === cursor) {
        const position = jobPosition.safeParse(JSON.parse(bytes.toString("utf8")));
        if (position.success) return { createdAt: new Date(position.data[0]), id: position.data[1] };
      }
    } catch {
      // Treat a malformed cursor like any other invalid query field.
    }
    context.addIssue({ code: "custom", message: "The cursor is not valid." });
    return z.NEVER;
  }).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export type ImportJobsQuery = z.infer<typeof importJobsQuerySchema>;
