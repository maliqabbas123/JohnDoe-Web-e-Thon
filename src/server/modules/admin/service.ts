import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { ListAuditLogsInput } from "./schemas";

// The administrator operates the platform: accounts, roles, access and
// oversight. Nothing here returns examination content, answer keys or
// candidates' answers; those belong to the examiner who owns the exam.

export async function listAuditLogs(filters: ListAuditLogsInput) {
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.entityId ? { entityId: filters.entityId } : {}),
    ...(filters.from || filters.to
      ? {
          createdAt: {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        ip: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return { items, meta: { page: filters.page, pageSize: filters.pageSize, total } };
}

// Counts only. "Ongoing" and "upcoming" are calculated from the slot and the
// server clock, as everywhere else.
export async function getPlatformOverview() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const realAttempt = { isSandbox: false } satisfies Prisma.AttemptWhereInput;

  const [
    usersByRole,
    inactiveUsers,
    examsByStatus,
    ongoingExams,
    upcomingExams,
    attemptsByStatus,
    interruptedAttempts,
    openDisputes,
    activeSessions,
    failedSignIns,
  ] = await Promise.all([
    db.user.groupBy({ by: ["role"], _count: { _all: true } }),
    db.user.count({ where: { isActive: false } }),
    db.exam.groupBy({ by: ["status"], _count: { _all: true } }),
    db.exam.count({ where: { status: "PUBLISHED", startsAt: { lte: now }, endsAt: { gte: now } } }),
    db.exam.count({ where: { status: "PUBLISHED", startsAt: { gt: now } } }),
    db.attempt.groupBy({ by: ["status"], where: realAttempt, _count: { _all: true } }),
    db.attempt.count({ where: { ...realAttempt, status: "IN_PROGRESS", connection: "INTERRUPTED" } }),
    db.dispute.count({ where: { status: "OPEN" } }),
    db.session.count({ where: { revokedAt: null, expiresAt: { gt: now } } }),
    db.auditLog.count({ where: { action: "LOGIN_FAILED", createdAt: { gte: dayAgo } } }),
  ]);

  const roleCount = (role: string) => usersByRole.find((row) => row.role === role)?._count._all ?? 0;
  const examCount = (status: string) => examsByStatus.find((row) => row.status === status)?._count._all ?? 0;
  const attemptCount = (status: string) =>
    attemptsByStatus.find((row) => row.status === status)?._count._all ?? 0;
  const totalUsers = usersByRole.reduce((sum, row) => sum + row._count._all, 0);

  return {
    serverTime: now.toISOString(),
    users: {
      total: totalUsers,
      active: totalUsers - inactiveUsers,
      inactive: inactiveUsers,
      administrators: roleCount("ADMIN"),
      examiners: roleCount("EXAMINER"),
      candidates: roleCount("CANDIDATE"),
    },
    exams: {
      draft: examCount("DRAFT"),
      published: examCount("PUBLISHED"),
      upcoming: upcomingExams,
      ongoing: ongoingExams,
      completed: examCount("COMPLETED"),
    },
    attempts: {
      inProgress: attemptCount("IN_PROGRESS"),
      interrupted: interruptedAttempts,
      submitted: attemptCount("SUBMITTED"),
      expired: attemptCount("EXPIRED"),
    },
    disputes: { open: openDisputes },
    sessions: { active: activeSessions },
    security: { failedSignInsLast24Hours: failedSignIns },
  };
}
