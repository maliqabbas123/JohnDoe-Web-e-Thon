import { randomUUID } from "node:crypto";
import { scoreObjective, type PaperSnapshot } from "../../src/server/exam/paper";
import { sql } from "./helpers";

type EvaluationQuestion = { id: string; marks: number; snapshot: PaperSnapshot };
type EvaluationExam = {
  id: string;
  ownerId: string;
  topicId: string;
  totalMarks: number;
  questions: EvaluationQuestion[];
};

// Insert the paper-side rows until the exam and attempt routes are available.
export async function seedEvaluationExam(ownerId: string, questionCount = 3): Promise<EvaluationExam> {
  const id = `e2e-eval-${randomUUID()}`;
  const topic = { id: `${id}-topic`, name: `Fixture ${id}` };
  await sql('INSERT INTO "Topic" (id, "ownerId", name) VALUES ($1, $2, $3)', [topic.id, ownerId, topic.name]);

  const questions = Array.from({ length: questionCount }, (_, index): EvaluationQuestion => {
    const questionId = `${id}-q${index + 1}`;
    const written = index % 3 !== 0;
    return {
      id: questionId,
      marks: written ? 2.5 : 0.1,
      snapshot: {
        version: 1,
        type: written ? "WRITTEN" : "SINGLE_CHOICE",
        difficulty: "MEDIUM",
        topic,
        text: `Frozen question ${index + 1}`,
        options: written ? [] : [
          { id: `${questionId}-correct`, text: "Correct choice", isCorrect: true },
          { id: `${questionId}-wrong`, text: "Wrong choice", isCorrect: false },
        ],
        multiSelectScoring: "ALL_OR_NOTHING",
      },
    };
  });
  const totalMarks = questions.reduce((cents, question) => cents + Math.round(question.marks * 100), 0) / 100;
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, status, "startsAt", "endsAt", "durationMinutes",
                         "totalMarks", "maxAttempts", "publishedAt", "updatedAt")
     VALUES ($1, $2, 'Evaluation fixture', 'PUBLISHED', now() - interval '1 day', now() + interval '1 hour',
             30, $3, NULL, now() - interval '2 days', now())`,
    [id, ownerId, totalMarks],
  );

  for (const [index, question] of questions.entries()) {
    const { id: questionId, marks, snapshot } = question;
    await sql(
      `INSERT INTO "Question" (id, "ownerId", "topicId", type, difficulty, text, "defaultMarks", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [questionId, ownerId, topic.id, snapshot.type, snapshot.difficulty, snapshot.text, marks],
    );
    for (const [optionIndex, option] of snapshot.options.entries()) {
      await sql(
        `INSERT INTO "QuestionOption" (id, "questionId", text, "isCorrect", position)
         VALUES ($1, $2, $3, $4, $5)`,
        [option.id, questionId, option.text, option.isCorrect, optionIndex + 1],
      );
    }
    await sql(
      `INSERT INTO "ExamQuestion" (id, "examId", "questionId", marks, position) VALUES ($1, $2, $3, $4, $5)`,
      [`${questionId}-pool`, id, questionId, marks, index + 1],
    );
  }

  return { id, ownerId, topicId: topic.id, totalMarks, questions };
}

type EvaluationAttemptOptions = {
  status?: "IN_PROGRESS" | "SUBMITTED" | "EXPIRED";
  submittedAt?: Date;
  attemptNumber?: number;
  isSandbox?: boolean;
};

export async function seedEvaluationAttempt(
  exam: EvaluationExam,
  userId: string,
  {
    status = "SUBMITTED",
    submittedAt = new Date(Date.now() - 60_000),
    attemptNumber = 1,
    isSandbox = false,
  }: EvaluationAttemptOptions = {},
): Promise<string> {
  const id = `e2e-attempt-${randomUUID()}`;
  const closed = status !== "IN_PROGRESS";
  const startedAt = new Date(submittedAt.getTime() - 120_000);
  const deadlineAt = status === "EXPIRED" ? submittedAt : new Date(startedAt.getTime() + 30 * 60_000);
  const answers = exam.questions.map(({ marks, snapshot }) => {
    const selected = snapshot.options.filter(({ isCorrect }) => isCorrect).map(({ id }) => id);
    return { selected, autoScore: closed ? scoreObjective(snapshot, selected, marks) : null };
  });
  const needsReview = answers.some(({ autoScore }) => autoScore === null);
  const gradingStatus = !closed ? "PENDING" : needsReview ? "NEEDS_REVIEW" : "GRADED";
  const total = needsReview ? null : answers.reduce((cents, { autoScore }) => cents + Math.round((autoScore ?? 0) * 100), 0) / 100;

  if (!isSandbox) {
    await sql(
      `INSERT INTO "Enrollment" (id, "examId", "candidateId", "enrolledById")
       VALUES ($1, $2, $3, $4) ON CONFLICT ("examId", "candidateId") DO NOTHING`,
      [`${id}-enrol`, exam.id, userId, exam.ownerId],
    );
  }
  await sql(
    `INSERT INTO "Attempt" (id, "examId", "userId", "attemptNumber", "isSandbox", status, "gradingStatus",
                            "startedAt", "deadlineAt", "submittedAt", "rulesAcceptedAt", "maxScore", score)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $8, $11, $12)`,
    [id, exam.id, userId, attemptNumber, isSandbox, status, gradingStatus,
      startedAt, deadlineAt, closed ? submittedAt : null, exam.totalMarks, total],
  );
  for (const [index, question] of exam.questions.entries()) {
    await sql(
      `INSERT INTO "AttemptQuestion" (id, "attemptId", "questionId", position, marks, snapshot, "optionOrder",
                                     "selectedOptionIds", "writtenAnswer", "autoScore")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [`${id}-answer-${index + 1}`, id, question.id, index + 1, question.marks, JSON.stringify(question.snapshot),
        question.snapshot.options.map(({ id }) => id).reverse(), answers[index].selected,
        question.snapshot.type === "WRITTEN" && index % 2 === 1 ? "Candidate's written answer" : null,
        answers[index].autoScore],
    );
  }
  return id;
}

export async function removeEvaluationExam(exam: EvaluationExam): Promise<void> {
  const attempts = 'SELECT id FROM "Attempt" WHERE "examId" = $1';
  await sql(
    `DELETE FROM "AuditLog"
     WHERE "entityType" = 'AttemptQuestion'
       AND "entityId" IN (SELECT id FROM "AttemptQuestion" WHERE "attemptId" IN (${attempts}))`,
    [exam.id],
  );
  await sql(`DELETE FROM "Report" WHERE "attemptId" IN (${attempts})`, [exam.id]);
  await sql('DELETE FROM "Attempt" WHERE "examId" = $1', [exam.id]);
  await sql('DELETE FROM "Exam" WHERE id = $1', [exam.id]);
  await sql('DELETE FROM "Question" WHERE "topicId" = $1', [exam.topicId]);
  await sql('DELETE FROM "Topic" WHERE id = $1', [exam.topicId]);
}
