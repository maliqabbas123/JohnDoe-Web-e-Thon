import { z } from "zod";
import type { FieldError } from "@/server/http/errors";

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 10;

const identifier = z.string().trim().min(1).max(64);
const questionType = z.enum(["SINGLE_CHOICE", "MULTIPLE_SELECT", "WRITTEN"]);
const difficulty = z.enum(["EASY", "MEDIUM", "HARD"], {
  error: "Label the question easy, medium or hard.",
});

// Marks allow quarter-marks and similar, to two decimal places.
const marks = z
  .number({ error: "Enter the marks as a number." })
  .min(0.25, "Marks must be at least 0.25.")
  .max(1000, "Marks must be at most 1000.")
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-9, {
    message: "Use at most two decimal places.",
  });

const questionText = z.string().trim().min(1, "Enter the question.").max(5000);
const explanation = z.string().trim().max(5000).nullable();

const option = z.strictObject({
  text: z.string().trim().min(1, "Enter the option text.").max(1000),
  isCorrect: z.boolean(),
});
export type OptionInput = z.infer<typeof option>;

const options = z.array(option).max(MAX_OPTIONS, `Use at most ${MAX_OPTIONS} options.`);

// The answer-key rules depend on the question type, and on update the type
// comes from the stored question, so the check is a function both paths use.
export function optionProblems(
  type: z.infer<typeof questionType>,
  given: OptionInput[] | undefined,
): FieldError[] {
  const problem = (message: string): FieldError[] => [{ path: "options", message }];

  if (type === "WRITTEN") {
    return given && given.length > 0 ? problem("A written-response question has no options.") : [];
  }
  if (!given || given.length < MIN_OPTIONS) {
    return problem(`Add at least ${MIN_OPTIONS} options.`);
  }

  const seen = new Set<string>();
  for (const { text } of given) {
    const key = text.toLowerCase();
    if (seen.has(key)) return problem("Each option must be different.");
    seen.add(key);
  }

  const correct = given.filter((candidate) => candidate.isCorrect).length;
  if (type === "SINGLE_CHOICE" && correct !== 1) {
    return problem("Mark exactly one option as correct.");
  }
  if (type === "MULTIPLE_SELECT" && correct < 1) {
    return problem("Mark at least one option as correct.");
  }
  return [];
}

export const createQuestionSchema = z
  .strictObject({
    topicId: identifier,
    type: questionType,
    difficulty,
    text: questionText,
    explanation: explanation.optional(),
    defaultMarks: marks,
    options: options.optional(),
  })
  .superRefine((value, context) => {
    for (const issue of optionProblems(value.type, value.options)) {
      context.addIssue({ code: "custom", path: [issue.path], message: issue.message });
    }
  });

// The type cannot be changed after creation: it decides how every past
// answer to the question was graded.
export const updateQuestionSchema = z
  .strictObject({
    topicId: identifier.optional(),
    difficulty: difficulty.optional(),
    text: questionText.optional(),
    explanation: explanation.optional(),
    defaultMarks: marks.optional(),
    options: options.optional(),
    isArchived: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Provide at least one field to change.",
  });

const flag = z.enum(["true", "false"]).transform((value) => value === "true");

export const listQuestionsSchema = z.object({
  topicId: identifier.optional(),
  type: questionType.optional(),
  difficulty: difficulty.optional(),
  // Archived questions are hidden unless asked for.
  isArchived: flag.default(false),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const topicName = z.string().trim().min(1, "Enter a topic name.").max(80);
export const createTopicSchema = z.strictObject({ name: topicName });
export const updateTopicSchema = z.strictObject({ name: topicName });

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ListQuestionsInput = z.infer<typeof listQuestionsSchema>;
export type TopicInput = z.infer<typeof createTopicSchema>;
