import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import type { ListAuditLogsInput } from "./schemas";

// A cursor is the (createdAt, id) of the last entry on the previous page,
// encoded so clients treat it as opaque.
type Position = { createdAt: Date; id: string };

function encodeCursor(position: Position): string {
  return Buffer.from(JSON.stringify([position.createdAt.toISOString(), position.id])).toString("base64url");
}

function decodeCursor(cursor: string): Position {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const time = new Date(createdAt);
    if (typeof id !== "string" || id.length === 0 || id.length > 64 || id.includes("\u0000")) throw new Error();
    if (typeof createdAt !== "string" || Number.isNaN(time.getTime())) throw new Error();
    return { createdAt: time, id };
  } catch {
    throw errors.validation([{ path: "cursor", message: "The cursor is not valid." }]);
  }
}

// The administrator operates the platform: accounts, roles, access and
// oversight. Nothing here returns examination content, answer keys or
// candidates' answers; those belong to the examiner who owns the exam.

export async function listAuditLogs(filters: ListAuditLogsInput) {
  const after = filters.cursor ? decodeCursor(filters.cursor) : undefined;

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

  // Entries strictly older than the cursor, in the same order as the index.
  // The plain "createdAt <= cursor" bound looks redundant next to the OR, but
  // it is what lets PostgreSQL start the index scan at the cursor instead of
  // walking down from the newest entry.
  const page: Prisma.AuditLogWhereInput = after
    ? {
        AND: [
          where,
          { createdAt: { lte: after.createdAt } },
          {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          },
        ],
      }
    : where;

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where: page,
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
      // One extra row tells us whether another page exists.
      take: filters.pageSize + 1,
    }),
    // Counted only on request, and only for the first page.
    filters.withTotal && !after ? db.auditLog.count({ where }) : Promise.resolve(undefined),
  ]);

  const hasMore = rows.length > filters.pageSize;
  const items = hasMore ? rows.slice(0, filters.pageSize) : rows;
  const last = items.at(-1);

  return {
    items,
    meta: {
      pageSize: filters.pageSize,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
      ...(total !== undefined ? { total } : {}),
    },
  };
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
