import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { effectiveScore, scoreObjective, type PaperSnapshot } from "@/server/exam/paper";
import { errors } from "@/server/http/errors";
import { recalculateAttempt } from "@/server/modules/grading/service";
import type { DecideItemInput } from "./schemas";

type Change = { examId: string; examinerId: string; itemId: string; questionId: string; reason: string; now: Date };
type Fix = Extract<DecideItemInput, Record<"action", "VOID_QUESTION" | "ACCEPT_ALTERNATIVE">>;

const numberOrNull = (value: Prisma.Decimal | null) => value === null ? null : Number(value);
const sameChoices = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

async function supersedeReports(tx: Prisma.TransactionClient, attemptIds: string[], now: Date) {
  await tx.report.updateMany({
    where: { attemptId: { in: attemptIds }, supersededAt: null, revokedAt: null },
    data: { supersededAt: now },
  });
}

export async function regradeItem(tx: Prisma.TransactionClient, change: Change & { attemptId: string }, score: number) {
  await tx.$queryRaw`SELECT id FROM "Attempt" WHERE id = ${change.attemptId} FOR NO KEY UPDATE`;
  const question = await tx.attemptQuestion.findUniqueOrThrow({
    where: { id: change.questionId },
    select: { marks: true, autoScore: true, manualScore: true },
  });
  if (score > Number(question.marks)) {
    throw errors.validation([{ path: "score", message: "The score cannot exceed the available marks." }]);
  }
  const before = effectiveScore(numberOrNull(question.autoScore), numberOrNull(question.manualScore));
  if (before === score) return 0;
  await tx.attemptQuestion.update({
    where: { id: change.questionId },
    data: { manualScore: score, gradedById: change.examinerId, gradedAt: change.now },
    select: { id: true },
  });
  await tx.gradeChange.create({
    data: { attemptQuestionId: change.questionId, previousScore: before, newScore: score,
      changedById: change.examinerId, disputeItemId: change.itemId, reason: change.reason },
    select: { id: true },
  });
  await recalculateAttempt(tx, change.attemptId);
  await supersedeReports(tx, [change.attemptId], change.now);
  return 1;
}

function revisedPaper(snapshot: PaperSnapshot, fix: Fix): PaperSnapshot | null {
  if (fix.action === "VOID_QUESTION") return snapshot.voided ? null : { ...snapshot, voided: true };
  if (!fix.optionIds.every((id) => snapshot.options.some((option) => option.id === id))) return null;
  if (snapshot.alsoAccepted?.some((choice) => sameChoices(choice, fix.optionIds))) return null;
  return { ...snapshot, alsoAccepted: [...(snapshot.alsoAccepted ?? []), fix.optionIds] };
}

export async function applyQuestionFix(tx: Prisma.TransactionClient, change: Change, fix: Fix) {
  const disputed = await tx.attemptQuestion.findUniqueOrThrow({
    where: { id: change.questionId }, select: { questionId: true, snapshot: true },
  });
  const original = disputed.snapshot as unknown as PaperSnapshot;
  if (fix.action === "ACCEPT_ALTERNATIVE" && (
    original.type === "WRITTEN" ||
    (original.type === "SINGLE_CHOICE" && fix.optionIds.length !== 1) ||
    !fix.optionIds.every((id) => original.options.some((option) => option.id === id))
  )) {
    throw errors.validation([{ path: "optionIds", message: "Choose a valid answer from the frozen options." }]);
  }

  const attempts = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT a.id, a.status FROM "Attempt" a
    WHERE a."examId" = ${change.examId} AND NOT a."isSandbox"
      AND EXISTS (SELECT 1 FROM "AttemptQuestion" q WHERE q."attemptId" = a.id AND q."questionId" = ${disputed.questionId})
    ORDER BY a.id FOR NO KEY UPDATE OF a
  `;
  const closed = new Set(attempts.filter(({ status }) => status !== "IN_PROGRESS").map(({ id }) => id));
  const servings = await tx.attemptQuestion.findMany({
    where: { questionId: disputed.questionId, attemptId: { in: attempts.map(({ id }) => id) } },
    select: { id: true, attemptId: true, snapshot: true, selectedOptionIds: true, marks: true, autoScore: true, manualScore: true },
  });

  const updates: { id: string; snapshot: PaperSnapshot; autoScore: number | null; manualScore: number | null }[] = [];
  const history: Prisma.GradeChangeCreateManyInput[] = [];
  const changedAttempts: string[] = [];
  for (const row of servings) {
    const snapshot = revisedPaper(row.snapshot as unknown as PaperSnapshot, fix);
    if (!snapshot) continue;
    let automatic = numberOrNull(row.autoScore);
    let manual = numberOrNull(row.manualScore);
    const before = effectiveScore(automatic, manual);

    if (closed.has(row.attemptId)) {
      const earned = scoreObjective(snapshot, row.selectedOptionIds, Number(row.marks));
      if (earned !== null) {
        automatic = Math.max(automatic ?? 0, earned);
        const awarded = fix.action === "VOID_QUESTION" || sameChoices(row.selectedOptionIds, fix.optionIds);
        if (awarded && manual !== null) manual = Math.max(manual, earned);
      }
    }

    updates.push({ id: row.id, snapshot, autoScore: automatic, manualScore: manual });
    const after = effectiveScore(automatic, manual);
    if (after !== null && after !== before) {
      changedAttempts.push(row.attemptId);
      history.push({ attemptQuestionId: row.id, previousScore: before, newScore: after,
        reason: change.reason, changedById: change.examinerId, disputeItemId: change.itemId });
    }
  }

  if (updates.length) {
    await tx.$executeRaw`
      UPDATE "AttemptQuestion" q
      SET snapshot = revised.snapshot, "autoScore" = revised."autoScore", "manualScore" = revised."manualScore"
      FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
        AS revised(id text, snapshot jsonb, "autoScore" numeric, "manualScore" numeric)
      WHERE q.id = revised.id
    `;
  }
  if (history.length) {
    await tx.gradeChange.createMany({ data: history });
    // Recalculate the affected closed papers together using the same
    // effective-score rule as manual grading. An incomplete total stays null.
    await tx.$executeRaw`
      WITH totals AS (
        SELECT q."attemptId", count(*) = count(coalesce(q."manualScore", q."autoScore")) AS graded,
               sum(coalesce(q."manualScore", q."autoScore")) AS score
        FROM "AttemptQuestion" q
        WHERE q."attemptId" IN (${Prisma.join(changedAttempts)})
        GROUP BY q."attemptId"
      )
      UPDATE "Attempt" a SET
        "gradingStatus" = CASE WHEN totals.graded THEN 'GRADED'::"GradingStatus" ELSE 'NEEDS_REVIEW'::"GradingStatus" END,
        score = CASE WHEN totals.graded THEN totals.score END
      FROM totals WHERE a.id = totals."attemptId"
    `;
    await supersedeReports(tx, changedAttempts, change.now);
  }
  return history.length;
}
