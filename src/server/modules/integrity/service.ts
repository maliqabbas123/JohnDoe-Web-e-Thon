import "server-only";
import { Prisma, type AttemptStatus, type IncidentType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { PaperSnapshot } from "@/server/exam/paper";
import { errors } from "@/server/http/errors";
import { analyzeIntegrity, computedTypes, type PeerAnswer } from "./analysis";

type ReviewFields = {
  integrityReviewNote: string | null;
  integrityReviewedById: string | null;
  integrityReviewedAt: Date | null;
};
type OwnedAttempt = ReviewFields & {
  examId: string;
  userId: string;
  status: AttemptStatus;
  honeypotMarker: string | null;
  blockClipboard: boolean;
};
function presentReview(row: ReviewFields) {
  if (!row.integrityReviewNote || !row.integrityReviewedAt) return null;
  return { note: row.integrityReviewNote, reviewedById: row.integrityReviewedById, reviewedAt: row.integrityReviewedAt };
}

async function lockClosedAttempt(tx: Prisma.TransactionClient, attemptId: string, examinerId: string) {
  const [attempt] = await tx.$queryRaw<OwnedAttempt[]>`
    SELECT a."examId", a."userId", a.status, a."honeypotMarker", e."blockClipboard",
           a."integrityReviewNote", a."integrityReviewedById", a."integrityReviewedAt"
    FROM "Attempt" a JOIN "Exam" e ON e.id = a."examId"
    WHERE a.id = ${attemptId} AND e."ownerId" = ${examinerId} AND NOT a."isSandbox"
    FOR UPDATE OF a
  `;
  if (!attempt) throw errors.notFound();
  if (attempt.status === "IN_PROGRESS") throw errors.conflict("The attempt must be closed before integrity review.");
  return attempt;
}

const labels: Partial<Record<IncidentType, string>> = {
  FAST_CORRECT_ANSWER: "Fast correct answer",
  PASTE_BYPASS: "High: paste block bypassed",
  SIMILAR_ANSWER: "Similar responses",
  HONEYPOT_TRIGGERED: "Attempt marker detected in an answer",
};

export async function getIntegrity(attemptId: string, examinerId: string, pageSize: number, cursor?: string) {
  return db.$transaction(async (tx) => {
    const attempt = await lockClosedAttempt(tx, attemptId, examinerId);
    const storedAnswers = await tx.attemptQuestion.findMany({
      where: { attemptId },
      select: {
        id: true, questionId: true, snapshot: true, selectedOptionIds: true, writtenAnswer: true,
        timeSpentSeconds: true, firstOpenedAt: true, savedAt: true, keystrokeCount: true, pasteCount: true,
      },
    });
    const answers = storedAnswers.map(({ snapshot, ...answer }) => ({
      ...answer, snapshot: snapshot as unknown as PaperSnapshot,
    }));
    const questionIds = answers
      .filter((answer) => (answer.writtenAnswer?.trim().length ?? 0) >= 80 || answer.selectedOptionIds.length > 0)
      .map(({ questionId }) => questionId);
    const peers = questionIds.length ? await tx.$queryRaw<PeerAnswer[]>`
      WITH latest AS (
        SELECT DISTINCT ON ("userId") id, "userId", "submittedAt"
        FROM "Attempt" WHERE "examId" = ${attempt.examId} AND "userId" <> ${attempt.userId}
          AND NOT "isSandbox" AND status IN ('SUBMITTED', 'EXPIRED')
        ORDER BY "userId", "submittedAt" DESC NULLS LAST, id DESC
      ), cohort AS (
        SELECT id FROM latest ORDER BY "submittedAt" DESC NULLS LAST, id DESC LIMIT 200
      )
      SELECT q."attemptId" AS "peerId", q."questionId", q.snapshot, q."selectedOptionIds",
             left(btrim(q."writtenAnswer"), 2000) AS "writtenAnswer"
      FROM cohort JOIN "AttemptQuestion" q ON q."attemptId" = cohort.id
      WHERE q."questionId" IN (${Prisma.join(questionIds)})
        AND (length(btrim(q."writtenAnswer")) >= 80 OR cardinality(q."selectedOptionIds") > 0)
      ORDER BY cohort.id, q.position LIMIT 4000
    ` : [];

    const computed = analyzeIntegrity(answers, peers, {
      marker: attempt.honeypotMarker, clipboardBlocked: attempt.blockClipboard,
    });
    if (computed.length) {
      const existing = await tx.incident.findMany({
        where: { attemptId, source: "SERVER", type: { in: [...computedTypes] } },
        select: { type: true, attemptQuestionId: true },
      });
      const key = (signal: { type: string; attemptQuestionId?: string | null }) =>
        signal.type + ":" + (signal.attemptQuestionId ?? "");
      const seen = new Set(existing.map(key));
      const data = computed.filter((signal) => !seen.has(key(signal))).map((signal) => ({
        ...signal, attemptId, source: "SERVER" as const,
      }));
      if (data.length) await tx.incident.createMany({ data });
    }

    const grouped = await tx.incident.groupBy({ by: ["severity"], where: { attemptId }, _count: true });
    const counts = { LOW: 0, MEDIUM: 0, HIGH: 0 };
    for (const row of grouped) counts[row.severity] = row._count;
    const rows = await tx.incident.findMany({
      where: { attemptId, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: pageSize + 1,
      select: {
        id: true, type: true, source: true, severity: true, details: true, createdAt: true,
        attemptQuestion: { select: { position: true } },
      },
    });
    const signals = rows.slice(0, pageSize).map(({ attemptQuestion, ...row }) => ({
      ...row, position: attemptQuestion?.position ?? null,
      label: labels[row.type] ?? "Signal for review",
    }));
    return {
      attemptId, counts, level: counts.HIGH ? "HIGH" : counts.MEDIUM ? "MEDIUM" : "LOW",
      review: presentReview(attempt), signals,
      nextCursor: rows.length > pageSize ? signals[signals.length - 1].id : null,
    };
  }, { timeout: 15_000 });
}

export async function reviewIntegrity(attemptId: string, examinerId: string, note: string) {
  return db.$transaction(async (tx) => {
    await lockClosedAttempt(tx, attemptId, examinerId);
    const saved = await tx.attempt.update({
      where: { id: attemptId },
      data: { integrityReviewNote: note, integrityReviewedById: examinerId, integrityReviewedAt: new Date() },
      select: { integrityReviewNote: true, integrityReviewedById: true, integrityReviewedAt: true },
    });
    return presentReview(saved);
  });
}
