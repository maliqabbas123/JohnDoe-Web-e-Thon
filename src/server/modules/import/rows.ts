import { errors } from "@/server/http/errors";
import { createQuestionSchema, MAX_OPTIONS, type CreateQuestionInput } from "@/server/modules/questions/schemas";
import { MAX_IMPORT_ROWS } from "./schemas";

const columns = ["topicId", "type", "difficulty", "text", "explanation", "defaultMarks", "options"] as const;

export type ImportRowError = { row: number; field: string; message: string };
export type QuestionImportRow = { row: number; question: CreateQuestionInput } | ImportRowError;

// Yield logical CSV records so commas and newlines inside quoted cells do not
// affect column counts or the row numbers in the report.
export function* csvRecords(text: string): Generator<string[]> {
  let record: string[] = [];
  let cell = "";
  let state: "unquoted" | "quoted" | "closed" = "unquoted";

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (state === "quoted") {
      if (char !== '"') {
        cell += char;
      } else if (text[index + 1] === '"') {
        cell += '"';
        index++;
      } else {
        state = "closed";
      }
    } else if (char === ",") {
      record.push(cell);
      cell = "";
      state = "unquoted";
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      yield [...record, cell];
      record = [];
      cell = "";
      state = "unquoted";
    } else if (state === "unquoted" && char !== '"') {
      cell += char;
    } else if (state === "unquoted" && cell === "") {
      state = "quoted";
    } else {
      throw errors.badRequest("The CSV file contains malformed quoting.");
    }
  }

  if (state === "quoted") throw errors.badRequest("The CSV file contains an unclosed quoted cell.");
  if (record.length || cell || state === "closed") yield [...record, cell];
}

function validateQuestion(input: unknown, row: number): QuestionImportRow {
  // Reject an oversized option set before validating each of its elements.
  if (
    input !== null && typeof input === "object" && "options" in input &&
    Array.isArray(input.options) && input.options.length > MAX_OPTIONS
  ) {
    return { row, field: "options", message: "Use at most " + MAX_OPTIONS + " options." };
  }

  const result = createQuestionSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    return {
      row,
      field: issue.path.join(".") || "row",
      message: issue.code === "unrecognized_keys" ? "Remove fields that are not part of a question." : issue.message,
    };
  }

  const question = result.data;
  const textFields: [string, string | null | undefined][] = [
    ["topicId", question.topicId],
    ["text", question.text],
    ["explanation", question.explanation],
    ...(question.options ?? []).map<[string, string]>((option, index) => ["options." + index + ".text", option.text]),
  ];
  for (const [field, value] of textFields) {
    if (value?.includes("\0") || value?.isWellFormed() === false) {
      return { row, field, message: "This field contains an invalid character." };
    }
  }
  return { row, question };
}

function csvRow(values: string[], row: number): QuestionImportRow {
  if (values.length !== columns.length) {
    return { row, field: "row", message: "Use exactly " + columns.length + " columns." };
  }

  const [topicId, type, difficulty, text, explanation, marks, optionsCell] = values;
  let options: unknown;
  if (optionsCell.trim()) {
    try {
      options = JSON.parse(optionsCell);
    } catch {
      return { row, field: "options", message: "Enter the options as a JSON array." };
    }
  }
  const defaultMarks = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(marks.trim()) ? Number(marks) : undefined;

  return validateQuestion({
    topicId,
    type: type.trim(),
    difficulty: difficulty.trim(),
    text,
    explanation,
    defaultMarks,
    options,
  }, row);
}

function parseCsv(text: string): QuestionImportRow[] {
  const records = csvRecords(text);
  const header = records.next().value;
  if (!header || header.length !== columns.length || columns.some((column, index) => header[index] !== column)) {
    throw errors.badRequest("The CSV header must be " + columns.join(",") + ".");
  }

  const rows: QuestionImportRow[] = [];
  for (const values of records) {
    if (rows.length === MAX_IMPORT_ROWS) throw errors.payloadTooLarge("Import at most 100 questions at a time.");
    rows.push(csvRow(values, rows.length + 2));
  }
  return rows;
}

function parseJson(text: string): QuestionImportRow[] {
  let content: unknown;
  try {
    content = JSON.parse(text);
  } catch {
    throw errors.badRequest("The import file must be valid JSON.");
  }
  if (!Array.isArray(content)) throw errors.badRequest("Send the JSON file as an array of question objects.");
  if (content.length > MAX_IMPORT_ROWS) throw errors.payloadTooLarge("Import at most 100 questions at a time.");
  return content.map((input: unknown, index) => validateQuestion(input, index + 1));
}

export function parseQuestionImport(format: "csv" | "json", text: string): QuestionImportRow[] {
  const rows = format === "csv" ? parseCsv(text) : parseJson(text);
  if (!rows.length) throw errors.badRequest("The import file contains no question rows.");
  return rows;
}
