import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { drawBalanced, shuffle } from "@/server/exam/draw";
import type { PaperSnapshot } from "@/server/exam/paper";
import { difficulties, difficultyCounts } from "@/server/exam/rules";
import { errors } from "@/server/http/errors";

type Settings = {
  id: string;
  selectionMode: "FIXED" | "BALANCED";
  questionCount: number | null;
  totalMarks: Prisma.Decimal;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  multiSelectScoring: PaperSnapshot["multiSelectScoring"];
};

export async function freezePaper(tx: Prisma.TransactionClient, exam: Settings) {
  // Keep the bank rows stable until the old paper or the edited paper can be
  // copied in full. Exam settings and membership are locked by the caller.
  await tx.$queryRaw`
    SELECT q.id FROM "Question" q
    JOIN "ExamQuestion" pool ON pool."questionId" = q.id
    WHERE pool."examId" = ${exam.id}
    ORDER BY q.id FOR SHARE OF q
  `;
  const pool = (await tx.examQuestion.findMany({
    where: { examId: exam.id },
    orderBy: { position: "asc" },
    select: {
      marks: true,
      question: {
        select: {
          id: true, topicId: true, type: true, difficulty: true, text: true,
          topic: { select: { id: true, name: true } },
          options: {
            orderBy: { position: "asc" },
            select: { id: true, text: true, isCorrect: true },
          },
        },
      },
    },
  })).map(({ marks, question }) => ({ ...question, marks }));

  let paper = pool;
  const marksByDifficulty = new Map<PaperSnapshot["difficulty"], Prisma.Decimal>();
  if (exam.selectionMode === "BALANCED") {
    const rules = await tx.examDifficultyRule.findMany({
      where: { examId: exam.id },
      select: { difficulty: true, percent: true, marksEach: true },
    });
    if (!exam.questionCount || rules.length !== difficulties.length ||
        rules.reduce((sum, rule) => sum + rule.percent, 0) !== 100) {
      throw errors.conflict("The exam's difficulty mix is incomplete.");
    }
    const percentages = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const rule of rules) {
      percentages[rule.difficulty] = rule.percent;
      marksByDifficulty.set(rule.difficulty, rule.marksEach);
    }
    const drawn = drawBalanced(pool, difficultyCounts(exam.questionCount, percentages));
    if (!drawn) throw errors.conflict("The question pool cannot fill the exam's difficulty mix.");
    paper = drawn;
  }

  if (exam.shuffleQuestions) paper = shuffle(paper);
  let availableCents = 0;
  const questions = paper.map((question, index) => {
    const marks = exam.selectionMode === "FIXED" ? question.marks : marksByDifficulty.get(question.difficulty);
    if (!marks || Number(marks) <= 0) throw errors.conflict("The paper has a question without valid marks.");
    availableCents += Math.round(Number(marks) * 100);
    const snapshot: PaperSnapshot = {
      version: 1,
      type: question.type,
      difficulty: question.difficulty,
      topic: question.topic,
      text: question.text,
      options: question.options,
      multiSelectScoring: exam.multiSelectScoring,
    };
    const order = question.options.map(({ id }) => id);
    return {
      questionId: question.id,
      position: index + 1,
      marks,
      snapshot,
      optionOrder: exam.shuffleOptions ? shuffle(order) : order,
    };
  });
  if (!questions.length || availableCents !== Math.round(Number(exam.totalMarks) * 100)) {
    throw errors.conflict("The paper does not match the exam's configured total marks.");
  }
  return questions;
}
