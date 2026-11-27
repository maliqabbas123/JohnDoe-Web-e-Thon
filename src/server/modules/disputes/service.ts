import "server-only";
import { Prisma, type Role } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import { gradedAttempts, ownedExam, resultPage } from "@/server/modules/results/service";
import { prepareAttachment } from "./attachment";
import { applyQuestionFix, regradeItem } from "./score-changes";
import type { DecideItemInput, ListDisputesInput, RaiseDisputeInput } from "./schemas";

const disputeSelect = {
  id: true,
  attemptId: true,
  category: true,
  status: true,
  explanation: true,
  createdAt: true,
  resolvedAt: true,
  attempt: { select: { exam: { select: { id: true, title: true } } } },
  raisedBy: { select: { id: true, name: true } },
  items: {
    orderBy: { id: "asc" },
    select: {
      id: true, decision: true, decisionReason: true, decidedAt: true,
      attemptQuestion: { select: { position: true } },
    },
  },
  attachment: { select: { fileName: true, mimeType: true, sizeBytes: true } },
  retakeGrant: { select: { id: true, startsAt: true, endsAt: true, attemptsAllowed: true } },
} satisfies Prisma.DisputeSelect;

function presentDispute({ attempt, raisedBy, items, ...details }: Prisma.DisputeGetPayload<{ select: typeof disputeSelect }>) {
  return {
    ...details,
    exam: attempt.exam,
    candidate: raisedBy,
    items: items.map(({ attemptQuestion, ...item }) => ({ ...item, position: attemptQuestion?.position ?? null })),
  };
}

export async function raiseDispute(candidateId: string, attemptId: string, input: RaiseDisputeInput) {
  const attachment = input.attachment ? prepareAttachment(input.attachment) : undefined;
  const disputeId = await db.$transaction(async (tx) => {
    const [attempt] = await tx.$queryRaw<{ releasedAt: Date; windowHours: number | null }[]>`
      SELECT a."resultReleasedAt" AS "releasedAt", e."disputeWindowHours" AS "windowHours"
      FROM "Attempt" a JOIN "Exam" e ON e.id = a."examId"
      WHERE a.id = ${attemptId} AND a."userId" = ${candidateId} AND ${gradedAttempts}
        AND a."resultReleasedAt" IS NOT NULL
      FOR NO KEY UPDATE OF a
    `;
    if (!attempt) throw errors.notFound();
    if (attempt.windowHours === null || Date.now() >= attempt.releasedAt.getTime() + attempt.windowHours * 3_600_000) {
      throw errors.conflict("The dispute window is closed.");
    }
    const questions = await tx.attemptQuestion.findMany({
      where: { attemptId, position: { in: input.positions } }, select: { id: true, position: true },
    });
    if (questions.length !== input.positions.length) {
      throw errors.validation([{ path: "positions", message: "Select questions from this attempt." }]);
    }
    const existing = await tx.disputeItem.findFirst({
      where: input.positions.length > 0
        ? { attemptQuestionId: { in: questions.map(({ id }) => id) } }
        : { attemptQuestionId: null, dispute: { attemptId } },
      select: { id: true },
    });
    if (existing) throw errors.conflict("A dispute already covers one or more selected questions.");

    const dispute = await tx.dispute.create({
      data: {
        attemptId, raisedById: candidateId, category: input.category, explanation: input.explanation,
        items: { create: questions.length ? questions.map(({ id }) => ({ attemptQuestionId: id })) : [{}] },
        ...(attachment ? { attachment: { create: attachment } } : {}),
      },
      select: { id: true },
    });
    return dispute.id;
  });
  return presentDispute(await db.dispute.findUniqueOrThrow({ where: { id: disputeId }, select: disputeSelect }));
}

async function listDisputes(where: Prisma.DisputeWhereInput, input: ListDisputesInput) {
  const rows = await db.dispute.findMany({
    where: { ...where, ...(input.status ? { status: input.status } : {}), ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
    orderBy: { id: "asc" }, take: input.pageSize + 1, select: disputeSelect,
  });
  const { items, meta } = resultPage(rows, input.pageSize, ({ id }) => id);
  return { items: items.map(presentDispute), meta };
}

export function listCandidateDisputes(candidateId: string, input: ListDisputesInput) {
  return listDisputes({ raisedById: candidateId, attempt: { userId: candidateId, isSandbox: false } }, input);
}

export async function listExamDisputes(examinerId: string, examId: string, input: ListDisputesInput) {
  await ownedExam(examId, examinerId);
  return listDisputes({ attempt: { examId, isSandbox: false, exam: { ownerId: examinerId } } }, input);
}

export async function examinerDispute(examinerId: string, id: string) {
  const row = await db.dispute.findFirst({
    where: { id, attempt: { isSandbox: false, exam: { ownerId: examinerId } } },
    select: disputeSelect,
  });
  if (!row) throw errors.notFound();
  return presentDispute(row);
}

export async function disputeAttachment(user: { id: string; role: Role }, disputeId: string) {
  const ownerScope: Prisma.DisputeWhereInput = user.role === "EXAMINER"
    ? { attempt: { isSandbox: false, exam: { ownerId: user.id } } }
    : { raisedById: user.id, attempt: { isSandbox: false, userId: user.id } };
  const attachment = await db.disputeAttachment.findFirst({
    where: { disputeId, dispute: ownerScope }, select: { fileName: true, mimeType: true, sizeBytes: true, data: true },
  });
  if (!attachment) throw errors.notFound();
  return attachment;
}

export async function decideDisputeItem(examinerId: string, disputeId: string, itemId: string, input: DecideItemInput) {
  await db.$transaction(async (tx) => {
    // Share the exam lock with releases and serialize multi-attempt corrections.
    const [owner] = await tx.$queryRaw<{ id: string; candidateId: string; attemptId: string }[]>`
      SELECT e.id, a."userId" AS "candidateId", a.id AS "attemptId"
      FROM "Dispute" d JOIN "Attempt" a ON a.id = d."attemptId" JOIN "Exam" e ON e.id = a."examId"
      WHERE d.id = ${disputeId} AND e."ownerId" = ${examinerId} AND NOT a."isSandbox"
      FOR NO KEY UPDATE OF e
    `;
    if (!owner) throw errors.notFound();

    const item = await tx.disputeItem.findFirst({
      where: { id: itemId, disputeId },
      select: {
        decision: true, attemptQuestionId: true,
        dispute: { select: { category: true } },
      },
    });
    if (!item) throw errors.notFound();
    if (item.decision !== "PENDING") throw errors.conflict("This item already has a decision.");
    const action = input.action;
    const allowed = {
      GRADING_ERROR: ["REGRADE"],
      FAULTY_QUESTION: ["ACCEPT_ALTERNATIVE", "VOID_QUESTION"],
      TECHNICAL_INCIDENT: ["GRANT_RETAKE"],
    }[item.dispute.category];
    if (action !== "REJECT" && !allowed.includes(action)) {
      throw errors.validation([{ path: "action", message: "This outcome does not apply to the dispute category." }]);
    }

    const now = new Date();
    const change = { examId: owner.id, examinerId, itemId, reason: input.reason, now };
    let changedScores = 0;
    if (input.action === "REGRADE" && item.attemptQuestionId) {
      changedScores = await regradeItem(tx, { ...change, attemptId: owner.attemptId, questionId: item.attemptQuestionId }, input.score);
    }
    if ((input.action === "VOID_QUESTION" || input.action === "ACCEPT_ALTERNATIVE") && item.attemptQuestionId) {
      changedScores = await applyQuestionFix(tx, { ...change, questionId: item.attemptQuestionId }, input);
    }
    if (input.action === "GRANT_RETAKE") {
      const { startsAt, endsAt, attemptsAllowed, reason } = input;
      if (endsAt <= startsAt || endsAt <= now) {
        throw errors.validation([{ path: "endsAt", message: "The retake must end after its start and in the future." }]);
      }
      const enrollment = await tx.enrollment.findUnique({
        where: { examId_candidateId: { examId: owner.id, candidateId: owner.candidateId } },
        select: { id: true },
      });
      if (!enrollment) throw errors.conflict("The candidate must be enrolled to receive a retake.");
      const grant = await tx.retakeGrant.create({
        data: { examId: owner.id, candidateId: owner.candidateId, grantedById: examinerId,
          disputeId, startsAt, endsAt, attemptsAllowed, reason },
        select: { id: true },
      });
      await writeAudit({
        actorId: examinerId, action: "RETAKE_GRANTED", entityType: "Exam", entityId: owner.id,
        metadata: { grantId: grant.id, disputeId },
      }, tx);
    }

    await tx.disputeItem.update({
      where: { id: itemId },
      data: { decision: action === "REJECT" ? "REJECTED" : "ACCEPTED", decisionReason: input.reason, decidedAt: now },
      select: { id: true },
    });
    const pending = await tx.disputeItem.count({ where: { disputeId, decision: "PENDING" } });
    if (!pending) {
      await tx.dispute.update({
        where: { id: disputeId },
        data: { status: "RESOLVED", resolvedAt: now, resolvedById: examinerId },
        select: { id: true },
      });
    }
    await writeAudit({
      actorId: examinerId, action: "DISPUTE_DECIDED", entityType: "Dispute", entityId: disputeId,
      metadata: { itemId, actionTaken: action, changedScores },
    }, tx);
  }, { timeout: 20_000 });
  return presentDispute(await db.dispute.findUniqueOrThrow({ where: { id: disputeId }, select: disputeSelect }));
}
