import "server-only";
import { Prisma, type AttemptStatus } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { scoreObjective, type PaperSnapshot } from "@/server/exam/paper";
import { errors } from "@/server/http/errors";

export type AttemptTransaction = Prisma.TransactionClient;

export const attemptSelect = {
  id: true,
  examId: true,
  attemptNumber: true,
  status: true,
  deadlineAt: true,
  submittedAt: true,
  currentPosition: true,
  currentOpenedAt: true,
  scratchpad: true,
  honeypotMarker: true,
  retakeGrantId: true,
  isSandbox: true,
} satisfies Prisma.AttemptSelect;

export type LockedAttempt = Prisma.AttemptGetPayload<{ select: typeof attemptSelect }>;

export async function lockAttempt(tx: AttemptTransaction, actor: SessionUser, id: string) {
  const [attempt] = await tx.$queryRaw<LockedAttempt[]>`
    SELECT id, "examId", "attemptNumber", status, "deadlineAt", "submittedAt", "currentPosition",
           "currentOpenedAt", scratchpad, "honeypotMarker", "retakeGrantId", "isSandbox"
    FROM "Attempt"
    WHERE id = ${id} AND "userId" = ${actor.id} AND "isSandbox" = ${actor.role === "EXAMINER"}
    FOR UPDATE
  `;
  if (!attempt) throw errors.notFound("Attempt not found.");
  return attempt;
}

export async function finishQuestionTiming(tx: AttemptTransaction, attempt: LockedAttempt, until: Date) {
  if (!attempt.currentOpenedAt) return;
  const elapsed = Math.max(0, Math.floor((+until - +attempt.currentOpenedAt) / 1000));
  if (elapsed > 0) {
    await tx.attemptQuestion.updateMany({
      where: { attemptId: attempt.id, position: attempt.currentPosition },
      data: { timeSpentSeconds: { increment: elapsed } },
    });
  }
}

// Call while holding the attempt row lock. This conditional transition and
// the question scores commit together, including expiry reached during a write.
export async function closeAttempt(tx: AttemptTransaction, attempt: LockedAttempt, now: Date): Promise<LockedAttempt> {
  if (attempt.status !== "IN_PROGRESS") return attempt;
  const status: Exclude<AttemptStatus, "IN_PROGRESS"> = attempt.deadlineAt <= now ? "EXPIRED" : "SUBMITTED";
  const submittedAt = status === "EXPIRED" ? attempt.deadlineAt : now;
  const questions = await tx.attemptQuestion.findMany({
    where: { attemptId: attempt.id },
    select: { id: true, snapshot: true, selectedOptionIds: true, marks: true },
  });
  const scored = questions.flatMap((question) => {
    const score = scoreObjective(question.snapshot as PaperSnapshot, question.selectedOptionIds, Number(question.marks));
    return score === null ? [] : [{ id: question.id, score }];
  });
  const needsReview = questions.length !== scored.length;
  const totalCents = scored.reduce((sum, { score }) => sum + Math.round(score * 100), 0);

  const changed = await tx.attempt.updateMany({
    where: { id: attempt.id, status: "IN_PROGRESS" },
    data: {
      status,
      submittedAt,
      currentOpenedAt: null,
      gradingStatus: needsReview ? "NEEDS_REVIEW" : "GRADED",
      score: needsReview ? null : totalCents / 100,
    },
  });
  if (changed.count === 0) return tx.attempt.findUniqueOrThrow({ where: { id: attempt.id }, select: attemptSelect });
  if (scored.length > 0) {
    await tx.$executeRaw`
      UPDATE "AttemptQuestion" q SET "autoScore" = scores.score
      FROM jsonb_to_recordset(${JSON.stringify(scored)}::jsonb) AS scores(id text, score numeric)
      WHERE q.id = scores.id AND q."attemptId" = ${attempt.id}
    `;
  }
  await finishQuestionTiming(tx, attempt, submittedAt);
  return { ...attempt, status, submittedAt, currentOpenedAt: null };
}

// Monitoring has already checked ownership and locked the same row.
export async function closeElapsedAttempt(tx: AttemptTransaction, id: string, now: Date) {
  const attempt = await tx.attempt.findUniqueOrThrow({ where: { id }, select: attemptSelect });
  if (attempt.deadlineAt <= now) await closeAttempt(tx, attempt, now);
}

export async function withOwnedAttempt<T>(
  actor: SessionUser,
  id: string,
  openOnly: boolean,
  action: (tx: AttemptTransaction, attempt: LockedAttempt, now: Date) => Promise<T>,
) {
  const result = await db.$transaction(async (tx) => {
    let attempt = await lockAttempt(tx, actor, id);
    const now = new Date();
    if (attempt.deadlineAt <= now) attempt = await closeAttempt(tx, attempt, now);
    if (openOnly && attempt.status !== "IN_PROGRESS") return { closed: true } as const;
    return { value: await action(tx, attempt, now) } as const;
  });
  if ("closed" in result) throw errors.conflict("The attempt is closed.");
  return result.value;
}
