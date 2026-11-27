import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { candidateExamAvailability, type ActiveExamAttempt } from "@/server/exam/availability";
import { examRules } from "@/server/exam/rules";
import { errors } from "@/server/http/errors";
import { lockOwnedExamRow } from "@/server/modules/exams/access";
import { consumeRateLimit } from "@/server/security/rate-limit";
import type { CreateRetakeGrantInput, EnrolmentPage } from "./schemas";

type Tx = Prisma.TransactionClient;
const snapshot = { isolationLevel: "RepeatableRead" } as const;

async function assertOwnedExam(tx: Tx, ownerId: string, id: string) {
  const exam = await tx.exam.findUnique({ where: { id, ownerId }, select: { id: true } });
  if (!exam) throw errors.notFound("Exam not found.");
}

function pageQuery({ page, pageSize }: EnrolmentPage) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export async function listEnrolments(owner: SessionUser, examId: string, pagination: EnrolmentPage) {
  return db.$transaction(async (tx) => {
    await assertOwnedExam(tx, owner.id, examId);
    const where = { examId };
    const [items, total] = await Promise.all([
      tx.enrollment.findMany({
        where,
        ...pageQuery(pagination),
        orderBy: { candidateId: "asc" },
        select: {
          createdAt: true,
          candidate: { select: { id: true, name: true, email: true } },
        },
      }),
      tx.enrollment.count({ where }),
    ]);
    return { items, meta: { ...pagination, total } };
  }, snapshot);
}

export async function enrolCandidates(owner: SessionUser, examId: string, emails: string[]) {
  return db.$transaction(async (tx) => {
    await lockOwnedExamRow(tx, owner.id, examId);
    const candidates = await tx.user.findMany({
      where: { role: "CANDIDATE", email: { in: [...new Set(emails)] } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(candidates.map(({ id, email }) => [email, id]));
    const created = candidates.length === 0 ? [] : await tx.enrollment.createManyAndReturn({
      data: candidates.map(({ id }) => ({ examId, candidateId: id, enrolledById: owner.id })),
      skipDuplicates: true,
      select: { candidateId: true },
    });
    const inserted = new Set(created.map(({ candidateId }) => candidateId));
    return emails.map((email) => {
      const candidate = byEmail.get(email);
      if (!candidate) return { email, status: "NOT_A_REGISTERED_CANDIDATE" as const };
      return { email, status: inserted.delete(candidate) ? "ENROLLED" as const : "ALREADY_ENROLLED" as const };
    });
  });
}

export async function removeEnrolment(owner: SessionUser, examId: string, candidateId: string) {
  await db.$transaction(async (tx) => {
    await lockOwnedExamRow(tx, owner.id, examId);
    const where = { examId, candidateId };
    const enrolment = await tx.enrollment.findUnique({
      where: { examId_candidateId: where },
      select: { id: true },
    });
    if (!enrolment) throw errors.notFound("Enrolment not found.");
    const attempt = await tx.attempt.findFirst({
      where: { examId, userId: candidateId, isSandbox: false },
      select: { id: true },
    });
    if (attempt) throw errors.conflict("The candidate has already attempted this exam.");
    await tx.enrollment.delete({ where: { id: enrolment.id }, select: { id: true } });
  });
}

const grantSelect = {
  id: true,
  candidateId: true,
  startsAt: true,
  endsAt: true,
  attemptsAllowed: true,
  reason: true,
  createdAt: true,
  revokedAt: true,
} satisfies Prisma.RetakeGrantSelect;

export async function listRetakeGrants(owner: SessionUser, examId: string, pagination: EnrolmentPage) {
  return db.$transaction(async (tx) => {
    await assertOwnedExam(tx, owner.id, examId);
    const where = { examId };
    const [items, total] = await Promise.all([
      tx.retakeGrant.findMany({
        where,
        ...pageQuery(pagination),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: grantSelect,
      }),
      tx.retakeGrant.count({ where }),
    ]);
    return { items, meta: { ...pagination, total } };
  }, snapshot);
}

export async function createRetakeGrant(owner: SessionUser, examId: string, input: CreateRetakeGrantInput) {
  return db.$transaction(async (tx) => {
    await lockOwnedExamRow(tx, owner.id, examId);
    const enrolment = await tx.enrollment.findUnique({
      where: {
        examId_candidateId: { examId, candidateId: input.candidateId },
        candidate: { role: "CANDIDATE" },
      },
      select: { id: true },
    });
    if (!enrolment) throw errors.notFound("Enrolment not found.");
    const grant = await tx.retakeGrant.create({
      data: { ...input, examId, grantedById: owner.id },
      select: grantSelect,
    });
    await writeAudit({
      actorId: owner.id,
      action: "RETAKE_GRANTED",
      entityType: "Exam",
      entityId: examId,
      metadata: {
        grantId: grant.id,
        candidateId: grant.candidateId,
        startsAt: grant.startsAt.toISOString(),
        endsAt: grant.endsAt.toISOString(),
        attemptsAllowed: grant.attemptsAllowed,
        reason: grant.reason,
      },
    }, tx);
    return grant;
  });
}

export async function joinExam(candidate: SessionUser, code: string) {
  await consumeRateLimit(`join-exam:${candidate.id}`, { limit: 10, windowSeconds: 15 * 60 });
  const unavailable = () => errors.notFound("Join code not found.");
  if (!/^[0-9a-f]{32}$/.test(code)) throw unavailable();

  return db.$transaction(async (tx) => {
    // Hold the code stable through enrolment, including a concurrent rotation.
    const [exam] = await tx.$queryRaw<{ id: string; ownerId: string; endsAt: Date }[]>`
      SELECT id, "ownerId", "endsAt" FROM "Exam"
      WHERE "joinCode" = ${code} AND status = 'PUBLISHED'
      FOR SHARE
    `;
    if (!exam || exam.endsAt <= new Date()) throw unavailable();
    const { count } = await tx.enrollment.createMany({
      data: { examId: exam.id, candidateId: candidate.id, enrolledById: exam.ownerId },
      skipDuplicates: true,
    });
    return { examId: exam.id, status: count === 1 ? "ENROLLED" as const : "ALREADY_ENROLLED" as const };
  });
}

const candidateExamSelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  durationMinutes: true,
  maxAttempts: true,
} satisfies Prisma.ExamSelect;

const retakeSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  attemptsAllowed: true,
  revokedAt: true,
} satisfies Prisma.RetakeGrantSelect;

async function readAttemptUsage(tx: Tx, userId: string, examIds: string[], now: Date) {
  const usage = new Map<string, Map<string | null, number>>();
  const active = new Map<string, ActiveExamAttempt>();
  if (examIds.length === 0) return { usage, active };

  const where = { userId, isSandbox: false, examId: { in: examIds } };
  const [counts, attempts] = await Promise.all([
    tx.attempt.groupBy({ by: ["examId", "retakeGrantId"], where, _count: { _all: true } }),
    tx.attempt.findMany({
      where: { ...where, status: "IN_PROGRESS", deadlineAt: { gt: now } },
      select: { id: true, examId: true, retakeGrantId: true, deadlineAt: true },
    }),
  ]);
  for (const row of counts) {
    const countsBySlot = usage.get(row.examId) ?? new Map<string | null, number>();
    countsBySlot.set(row.retakeGrantId, row._count._all);
    usage.set(row.examId, countsBySlot);
  }
  for (const attempt of attempts) active.set(attempt.examId, attempt);
  return { usage, active };
}

function presentCandidateExam(
  exam: Prisma.ExamGetPayload<{ select: typeof candidateExamSelect }>,
  retakes: Prisma.RetakeGrantGetPayload<{ select: typeof retakeSelect }>[],
  { usage, active }: Awaited<ReturnType<typeof readAttemptUsage>>,
  now: Date,
) {
  return {
    id: exam.id,
    title: exam.title,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMinutes: exam.durationMinutes,
    ...candidateExamAvailability(exam, retakes, usage.get(exam.id) ?? new Map(), active.get(exam.id) ?? null, now),
  };
}

export async function listCandidateExams(candidate: SessionUser, pagination: EnrolmentPage) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const where = { candidateId: candidate.id, exam: { status: { not: "DRAFT" as const } } };
    const [enrolments, total] = await Promise.all([
      tx.enrollment.findMany({
        where,
        ...pageQuery(pagination),
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: {
          exam: { select: candidateExamSelect },
          retakeGrants: { where: { endsAt: { gt: now } }, select: retakeSelect },
        },
      }),
      tx.enrollment.count({ where }),
    ]);
    const attempts = await readAttemptUsage(tx, candidate.id, enrolments.map(({ exam }) => exam.id), now);
    return {
      items: enrolments.map(({ exam, retakeGrants }) => presentCandidateExam(exam, retakeGrants, attempts, now)),
      meta: { ...pagination, total },
    };
  }, snapshot);
}

export async function getCandidateExam(candidate: SessionUser, examId: string) {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const enrolment = await tx.enrollment.findUnique({
      where: {
        examId_candidateId: { examId, candidateId: candidate.id },
        exam: { status: { not: "DRAFT" } },
      },
      select: {
        exam: {
          select: {
            ...candidateExamSelect,
            instructions: true,
            totalMarks: true,
            resultPolicy: true,
            selectionMode: true,
            multiSelectScoring: true,
            shuffleQuestions: true,
            shuffleOptions: true,
            desktopOnly: true,
            blockClipboard: true,
            blockContextMenu: true,
            requireFullscreen: true,
            detectExtraDisplay: true,
            watermark: true,
            aiNotice: true,
            honeypot: true,
          },
        },
        retakeGrants: { where: { endsAt: { gt: now } }, select: retakeSelect },
      },
    });
    if (!enrolment) throw errors.notFound("Exam not found.");
    const { exam, retakeGrants } = enrolment;
    const attempts = await readAttemptUsage(tx, candidate.id, [examId], now);
    return {
      ...presentCandidateExam(exam, retakeGrants, attempts, now),
      instructions: exam.instructions,
      rules: examRules(exam),
      serverTime: now,
    };
  }, snapshot);
}
