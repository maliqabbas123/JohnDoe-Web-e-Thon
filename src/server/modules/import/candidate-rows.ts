import { emailSchema, nameSchema } from "@/server/modules/auth/schemas";
import { errors } from "@/server/http/errors";
import { z } from "zod";
import { csvRecords, type ImportRowError } from "./rows";
import { questionImportQuerySchema } from "./schemas";

const MAX_CANDIDATE_ROWS = 50;
const columns = ["email", "name"];
const candidateSchema = z.strictObject({
  email: emailSchema,
  name: nameSchema.refine((name) => name.isWellFormed() && !name.includes("\0"), "Enter a valid name."),
});
export const candidateImportQuery = z.strictObject({
  examId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  fileName: questionImportQuerySchema.shape.fileName,
});

type Candidate = z.infer<typeof candidateSchema>;
export type CandidateRow = { row: number; candidate: Candidate } | ImportRowError;

function validateRow(input: unknown, row: number): CandidateRow {
  const parsed = candidateSchema.safeParse(input);
  if (parsed.success) return { row, candidate: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    row,
    field: issue.path.join(".") || "row",
    message: issue.code === "unrecognized_keys" ? "Use only email and name." : issue.message,
  };
}

function candidateJson(text: string): CandidateRow[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw errors.badRequest("The import file must be valid JSON.");
  }
  if (!Array.isArray(value)) throw errors.badRequest("Send the JSON file as an array of candidate objects.");
  if (value.length > MAX_CANDIDATE_ROWS) throw errors.payloadTooLarge("Import at most 50 candidates at a time.");
  return value.map((input: unknown, index) => validateRow(input, index + 1));
}

function candidateCsv(text: string): CandidateRow[] {
  const records = csvRecords(text);
  const header = records.next().value;
  if (!header || header.length !== columns.length || columns.some((column, index) => header[index] !== column)) {
    throw errors.badRequest("The CSV header must be email,name.");
  }
  const rows: CandidateRow[] = [];
  for (const values of records) {
    if (rows.length === MAX_CANDIDATE_ROWS) throw errors.payloadTooLarge("Import at most 50 candidates at a time.");
    const row = rows.length + 2;
    rows.push(values.length === columns.length
      ? validateRow({ email: values[0], name: values[1] }, row)
      : { row, field: "row", message: "Use exactly two columns." });
  }
  return rows;
}

export function parseCandidateImport(format: "csv" | "json", text: string): CandidateRow[] {
  const rows = format === "csv" ? candidateCsv(text) : candidateJson(text);
  if (!rows.length) throw errors.badRequest("The import file contains no candidate rows.");
  return rows;
}
