import { difficulties, difficultyCounts } from "@/server/exam/rules";
import type { Difficulty } from "@/server/exam/paper";
import type { FieldError } from "@/server/http/errors";

type Marks = number | { toString(): string };
type ReviewExam = {
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  selectionMode: "FIXED" | "BALANCED";
  totalMarks: Marks;
  questionCount: number | null;
  questions: { marks: Marks | null; question: { difficulty: Difficulty; isArchived: boolean } }[];
  difficultyRules: { difficulty: Difficulty; percent: number; marksEach: Marks }[];
};

const cents = (marks: Marks) => Math.round(Number(marks) * 100);

export function slotProblems({ startsAt, endsAt, durationMinutes }: Pick<ReviewExam, "startsAt" | "endsAt" | "durationMinutes">): FieldError[] {
  if (endsAt <= startsAt) return [{ path: "endsAt", message: "The slot must end after it starts." }];
  if (durationMinutes * 60_000 > endsAt.getTime() - startsAt.getTime()) {
    return [{ path: "durationMinutes", message: "The duration must fit inside the slot." }];
  }
  return [];
}

export function reviewPaper(exam: ReviewExam, now: Date) {
  const errors = slotProblems(exam);
  const warnings: FieldError[] = [];
  if (exam.startsAt <= now) errors.push({ path: "startsAt", message: "The slot must start in the future." });
  if (exam.questions.some(({ question }) => question.isArchived)) {
    errors.push({ path: "questions", message: "Remove archived questions before publishing." });
  }

  let paperCents: number | null = null;
  const difficulty: { difficulty: Difficulty; available: number; required: number; percent: number; marksEach: number }[] = [];
  if (exam.selectionMode === "FIXED") {
    if (exam.questions.length === 0) errors.push({ path: "questions", message: "Add at least one question to the pool." });
    if (exam.questions.some(({ marks }) => marks === null || Number(marks) <= 0)) {
      errors.push({ path: "questions.marks", message: "Set positive marks for every fixed-paper question." });
    } else {
      paperCents = exam.questions.reduce((sum, { marks }) => sum + cents(marks ?? 0), 0);
    }
  } else {
    if (!exam.questionCount) errors.push({ path: "questionCount", message: "Set the number of questions per paper." });
    const percentages = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const rule of exam.difficultyRules) percentages[rule.difficulty] = rule.percent;
    const hasMix = exam.difficultyRules.length === difficulties.length &&
      Object.values(percentages).reduce((sum, percent) => sum + percent, 0) === 100;
    if (!hasMix) errors.push({ path: "difficultyRules", message: "Set all three difficulty percentages so they total 100." });
    if (hasMix && exam.questionCount) {
      const counts = difficultyCounts(exam.questionCount, percentages);
      const available = { EASY: 0, MEDIUM: 0, HARD: 0 };
      for (const { question } of exam.questions) {
        if (!question.isArchived) available[question.difficulty]++;
      }
      const byDifficulty = new Map(exam.difficultyRules.map((rule) => [rule.difficulty, rule]));
      paperCents = 0;
      for (const level of difficulties) {
        const rule = byDifficulty.get(level);
        if (!rule) continue;
        const required = counts[level];
        const path = `questions.${level}`;
        if (available[level] < required) {
          errors.push({ path, message: `Add more ${level.toLowerCase()} questions. Need ${required}, have ${available[level]}.` });
        } else if (required > 0 && available[level] === required) {
          warnings.push({ path, message: `Every paper will use the same ${level.toLowerCase()} questions.` });
        }
        difficulty.push({
          difficulty: level,
          available: available[level],
          required,
          percent: rule.percent,
          marksEach: Number(rule.marksEach),
        });
        paperCents += required * cents(rule.marksEach);
      }
    }
  }
  if (paperCents !== null && paperCents !== cents(exam.totalMarks)) {
    errors.push({ path: "totalMarks", message: `The paper is worth ${paperCents / 100} marks. It must total ${Number(exam.totalMarks)}.` });
  }
  return {
    canPublish: errors.length === 0,
    errors,
    warnings,
    questionCount: exam.selectionMode === "FIXED" ? exam.questions.length : exam.questionCount,
    paperMarks: paperCents === null ? null : paperCents / 100,
    difficulty,
  };
}
