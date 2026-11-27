import { z } from "zod";
import { difficulties } from "@/server/exam/rules";

const MAX_QUESTIONS = 500;
const positiveInt = z.number().int().min(1).max(2_147_483_647);
const marks = z.number().min(0.01).max(99999.99).refine(
  (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Use at most two decimal places.",
);
// Timestamps are stored at millisecond precision. Preserve the requested instant.
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

export const createExamSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  instructions: z.string().trim().max(10_000).optional(),
  startsAt: instant,
  endsAt: instant,
  durationMinutes: positiveInt,
  totalMarks: marks,
  selectionMode: z.enum(["FIXED", "BALANCED"]).optional(),
  shuffleQuestions: z.boolean().optional(),
  shuffleOptions: z.boolean().optional(),
  multiSelectScoring: z.enum(["ALL_OR_NOTHING", "PARTIAL"]).optional(),
  maxAttempts: positiveInt.nullable().optional(),
  resultPolicy: z.enum(["BEST", "LATEST"]).optional(),
  disputeWindowHours: positiveInt.nullable().optional(),
  revealAnswers: z.boolean().optional(),
  desktopOnly: z.boolean().optional(),
  blockClipboard: z.boolean().optional(),
  blockContextMenu: z.boolean().optional(),
  requireFullscreen: z.boolean().optional(),
  detectExtraDisplay: z.boolean().optional(),
  watermark: z.boolean().optional(),
  aiNotice: z.boolean().optional(),
  honeypot: z.boolean().optional(),
});

export const updateExamSchema = createExamSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one field to change.",
);

export const questionPoolSchema = z.strictObject({
  questions: z.array(z.strictObject({
    questionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    marks: marks.nullable().optional(),
  })).max(MAX_QUESTIONS),
}).superRefine(({ questions }, context) => {
  const seen = new Set<string>();
  for (const [index, question] of questions.entries()) {
    if (seen.has(question.questionId)) {
      context.addIssue({ code: "custom", path: ["questions", index, "questionId"], message: "Use each question only once." });
    }
    seen.add(question.questionId);
  }
});

export const difficultyRulesSchema = z.strictObject({
  questionCount: positiveInt.max(MAX_QUESTIONS),
  rules: z.array(z.strictObject({
    difficulty: z.enum(difficulties),
    percent: z.number().int().min(0).max(100),
    marksEach: marks,
  })).length(difficulties.length),
}).refine(
  ({ rules }) => new Set(rules.map((rule) => rule.difficulty)).size === difficulties.length,
  { path: ["rules"], message: "Provide one rule for each difficulty." },
);

export const listExamsSchema = z.strictObject({
  state: z.enum(["DRAFT", "PUBLISHED", "ONGOING", "COMPLETED"]).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateExamInput = z.infer<typeof createExamSchema>;
export type UpdateExamInput = z.infer<typeof updateExamSchema>;
export type QuestionPoolInput = z.infer<typeof questionPoolSchema>;
export type DifficultyRulesInput = z.infer<typeof difficultyRulesSchema>;
export type ListExamsInput = z.infer<typeof listExamsSchema>;
