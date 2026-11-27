import "server-only";
import { Prisma, type AttemptStatus, type GradingStatus } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import { db } from "@/server/db";
import { effectiveScore, type PaperSnapshot } from "@/server/exam/paper";
import { errors } from "@/server/http/errors";
import type { GradeAnswerInput, ListGradingQueueInput } from "./schemas";

type Examiner = { id: string };

const gradingFields = { gradingStatus: true, score: true } as const;
const numberOrNull = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

function requireClosed(status: AttemptStatus): void {
  if (status === "IN_PROGRESS") throw errors.conflict("The attempt must be closed before grading.");
}

type QueueRow = {
  id: string;
  attemptId: string;
  position: number;
  submittedAt: Date;
  marks: Prisma.Decimal;
  candidateId: string;
  candidateName: string;
};

export async function listGradingQueue(examiner: Examiner, examId: string, filters: ListGradingQueueInput) {
  const after = filters.cursor
    ? Prisma.sql`AND (a."submittedAt", q.id) > (${filters.cursor[0]}, ${filters.cursor[1]})`
    : Prisma.empty;
  // The lateral join returns an empty row for an owned exam with no pending
  // answers. Resolve candidate names only for entries on the requested page.
  const rows = await db.$queryRaw<(QueueRow | { id: null })[]>`
    SELECT page.id, page."attemptId", page.position, page."submittedAt", page.marks,
           u.id AS "candidateId", u.name AS "candidateName"
    FROM "Exam" e
    LEFT JOIN LATERAL (
      SELECT q.id, q."attemptId", q.position, a."submittedAt", q.marks, a."userId"
      FROM "Attempt" a
      JOIN "AttemptQuestion" q ON q."attemptId" = a.id
      WHERE a."examId" = e.id
        AND a.status IN ('SUBMITTED', 'EXPIRED') AND a."gradingStatus" = 'NEEDS_REVIEW'
        AND NOT a."isSandbox" AND a."submittedAt" IS NOT NULL
        AND q."autoScore" IS NULL AND q."manualScore" IS NULL AND q.snapshot->>'type' = 'WRITTEN'
        ${after}
      ORDER BY a."submittedAt", q.id
      LIMIT ${filters.pageSize + 1}
    ) page ON true
    LEFT JOIN "User" u ON u.id = page."userId"
    WHERE e.id = ${examId} AND e."ownerId" = ${examiner.id}
    ORDER BY page."submittedAt", page.id
  `;
  if (!rows.length) throw errors.notFound();
  const items = rows.filter((row) => row.id !== null).slice(0, filters.pageSize);
  const last = items.at(-1);

  return {
    items: items.map(({ attemptId, position, submittedAt, marks, candidateId, candidateName }) => ({
      attemptId,
      position,
      submittedAt,
      marks: Number(marks),
      candidate: { id: candidateId, name: candidateName },
    })),
    meta: {
      pageSize: filters.pageSize,
      nextCursor: last && rows.length > filters.pageSize
        ? Buffer.from(JSON.stringify([last.submittedAt, last.id])).toString("base64url")
        : null,
    },
  };
}

type ReviewRow = LockedAttempt & {
  id: string;
  examId: string;
  examTitle: string;
  candidateId: string;
  candidateName: string;
  attemptNumber: number;
  submittedAt: Date;
  maxScore: Prisma.Decimal;
};

export async function reviewAttempt(examiner: Examiner, attemptId: string) {
  // Read the attempt and its questions from one snapshot so a grade saved
  // during the read cannot leave the total out of sync.
  return db.$transaction(async (tx) => {
    const [attempt] = await tx.$queryRaw<ReviewRow[]>`
      SELECT a.id, a."examId", e.title AS "examTitle", u.id AS "candidateId", u.name AS "candidateName",
             a."attemptNumber", a.status, a."submittedAt", a."gradingStatus", a.score, a."maxScore", a."resultReleasedAt"
      FROM "Attempt" a
      JOIN "Exam" e ON e.id = a."examId"
      JOIN "User" u ON u.id = a."userId"
      WHERE a.id = ${attemptId} AND e."ownerId" = ${examiner.id} AND NOT a."isSandbox"
    `;
    if (!attempt) throw errors.notFound();
    requireClosed(attempt.status);

    const questions = await tx.attemptQuestion.findMany({
      where: { attemptId },
      orderBy: { position: "asc" },
      select: {
        position: true,
        marks: true,
        snapshot: true,
        optionOrder: true,
        selectedOptionIds: true,
        writtenAnswer: true,
        autoScore: true,
        manualScore: true,
        feedback: true,
        gradedAt: true,
      },
    });

    const { examId, examTitle, candidateId, candidateName, score, maxScore, ...details } = attempt;
    return {
      ...details,
      exam: { id: examId, title: examTitle },
      candidate: { id: candidateId, name: candidateName },
      score: numberOrNull(score),
      maxScore: Number(maxScore),
      questions: questions.map(({ snapshot, optionOrder, marks, autoScore, manualScore, ...question }) => {
        const paper = snapshot as unknown as PaperSnapshot;
        const optionsById = new Map(paper.options.map((option) => [option.id, option]));
        const options = optionOrder
          .map((id) => optionsById.get(id))
          .filter((option) => option !== undefined)
          .map(({ id, text, isCorrect }) => ({ id, text, isCorrect }));
        const automatic = numberOrNull(autoScore);
        const manual = numberOrNull(manualScore);
        return {
          ...question,
          type: paper.type,
          difficulty: paper.difficulty,
          topic: { id: paper.topic.id, name: paper.topic.name },
          text: paper.text,
          options,
          alsoAccepted: paper.alsoAccepted ?? [],
          voided: paper.voided ?? false,
          marks: Number(marks),
          autoScore: automatic,
          manualScore: manual,
          score: effectiveScore(automatic, manual),
        };
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

// Call after locking the attempt row and applying score changes in the same
// transaction. Integer cents keep sums exact when marks include fractions.
export async function recalculateAttempt(tx: Prisma.TransactionClient, attemptId: string) {
  const questions = await tx.attemptQuestion.findMany({
    where: { attemptId },
    select: { autoScore: true, manualScore: true },
  });

  let needsReview = false;
  let totalCents = 0;
  for (const question of questions) {
    const score = effectiveScore(numberOrNull(question.autoScore), numberOrNull(question.manualScore));
    if (score === null) needsReview = true;
    else totalCents += Math.round(score * 100);
  }

  return tx.attempt.update({
    where: { id: attemptId },
    data: {
      gradingStatus: needsReview ? "NEEDS_REVIEW" : "GRADED",
      score: needsReview ? null : totalCents / 100,
    },
    select: gradingFields,
  });
}

type LockedAttempt = {
  status: AttemptStatus;
  gradingStatus: GradingStatus;
  score: Prisma.Decimal | null;
  resultReleasedAt: Date | null;
};

const answerGradeFields = { position: true, manualScore: true, feedback: true, gradedAt: true } as const;

export async function gradeAnswer(
  examiner: Examiner,
  attemptId: string,
  position: number,
  input: GradeAnswerInput,
  ip: string | null,
) {
  return db.$transaction(async (tx) => {
    // Serialize writes to the same paper, including writes to different
    // answers, before reading the old score or release state.
    const [attempt] = await tx.$queryRaw<LockedAttempt[]>`
      SELECT a.status, a."gradingStatus", a.score, a."resultReleasedAt"
      FROM "Attempt" a
      JOIN "Exam" e ON e.id = a."examId"
      WHERE a.id = ${attemptId} AND e."ownerId" = ${examiner.id} AND NOT a."isSandbox"
      FOR NO KEY UPDATE OF a
    `;
    if (!attempt) throw errors.notFound();
    requireClosed(attempt.status);

    const question = await tx.attemptQuestion.findUnique({
      where: { attemptId_position: { attemptId, position } },
      select: { id: true, marks: true, snapshot: true, autoScore: true, ...answerGradeFields },
    });
    if (!question) throw errors.notFound();
    const paper = question.snapshot as unknown as PaperSnapshot;
    if (paper.type !== "WRITTEN") {
      throw errors.validation([{ path: "position", message: "Only written answers can be graded manually." }]);
    }
    if (input.score > Number(question.marks)) {
      throw errors.validation([{ path: "score", message: "The score cannot exceed the question's marks." }]);
    }

    const { score, reason } = input;
    const feedback = input.feedback === undefined ? question.feedback : input.feedback;
    const previousScore = effectiveScore(numberOrNull(question.autoScore), numberOrNull(question.manualScore));
    const scoreChanged = previousScore !== score;
    const released = attempt.resultReleasedAt !== null;
    if (released && scoreChanged && !reason) {
      throw errors.validation([{ path: "reason", message: "Explain why the released score is changing." }]);
    }

    let answer = {
      position: question.position,
      manualScore: numberOrNull(question.manualScore),
      feedback: question.feedback,
      gradedAt: question.gradedAt,
    };
    let total = { gradingStatus: attempt.gradingStatus, score: numberOrNull(attempt.score) };
    if (answer.manualScore !== score || answer.feedback !== feedback) {
      const gradedAt = new Date();
      await tx.attemptQuestion.update({
        where: { id: question.id },
        data: { manualScore: score, feedback, gradedAt, gradedById: examiner.id },
        select: { id: true },
      });
      answer = { position, manualScore: score, feedback, gradedAt };

      if (scoreChanged && (released || previousScore !== null)) {
        await tx.gradeChange.create({
          data: {
            attemptQuestionId: question.id,
            previousScore,
            newScore: score,
            reason: reason ?? "Score revised before release.",
            changedById: examiner.id,
          },
          select: { id: true },
        });
      }
      if (released && scoreChanged) {
        await tx.report.updateMany({
          where: { attemptId, supersededAt: null, revokedAt: null },
          data: { supersededAt: gradedAt },
        });
      }

      const updated = await recalculateAttempt(tx, attemptId);
      total = { gradingStatus: updated.gradingStatus, score: numberOrNull(updated.score) };
      await writeAudit({
        actorId: examiner.id,
        action: "ANSWER_GRADED",
        entityType: "AttemptQuestion",
        entityId: question.id,
        metadata: { attemptId, position, scoreChanged, released },
        ip,
      }, tx);
    }

    return { attempt: { id: attemptId, ...total }, answer };
  });
}
