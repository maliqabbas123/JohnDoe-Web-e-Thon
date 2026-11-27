import "server-only";
import { Prisma, type AttemptStatus, type ConnectionState } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { assertExamOwner } from "./announcements";
import { effectiveAttemptStatus, sweepDisruptions } from "./contact";
import type { MonitorQuery } from "./schemas";

type MonitorRow = {
  id: string;
  candidateId: string;
  candidateName: string;
  attemptNumber: number;
  status: AttemptStatus;
  connection: ConnectionState;
  lastSeenAt: Date;
  deadlineAt: Date;
  currentPosition: number;
  questionCount: number;
  answeredCount: number;
  incidentCount: number;
  disruptionCount: number | null;
  gapStart: Date | null;
  gapEnd: Date | null;
};

export async function getExamMonitor(examId: string, ownerId: string, { cursor, pageSize }: MonitorQuery) {
  await assertExamOwner(examId, ownerId);
  const serverTime = new Date();
  await sweepDisruptions(examId, serverTime);

  // Page before reading counts. The lateral reads use existing indexes on
  // attemptId and do not return any question text or candidate answers.
  const rows = await db.$queryRaw<MonitorRow[]>`
    SELECT a.id, u.id AS "candidateId", u.name AS "candidateName", a."attemptNumber", a.status,
           a.connection, a."lastSeenAt", a."deadlineAt", a."currentPosition",
           questions.total AS "questionCount", questions.answered AS "answeredCount",
           signals.total AS "incidentCount", gaps.total AS "disruptionCount",
           gaps."startedAt" AS "gapStart", gaps."endedAt" AS "gapEnd"
    FROM (
      SELECT id, "userId", "attemptNumber", status, connection, "lastSeenAt", "deadlineAt", "currentPosition"
      FROM "Attempt" WHERE "examId" = ${examId} AND NOT "isSandbox"
        ${cursor ? Prisma.sql`AND id > ${cursor}` : Prisma.empty}
      ORDER BY id LIMIT ${pageSize + 1}
    ) a
    JOIN "User" u ON u.id = a."userId"
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE cardinality(q."selectedOptionIds") > 0 OR q."writtenAnswer" ~ '[^[:space:]]')::int AS answered
      FROM "AttemptQuestion" q WHERE q."attemptId" = a.id
    ) questions
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS total FROM "Incident" i WHERE i."attemptId" = a.id
    ) signals
    LEFT JOIN LATERAL (
      SELECT count(*) OVER ()::int AS total, d."startedAt", d."endedAt"
      FROM "Disruption" d WHERE d."attemptId" = a.id
      ORDER BY d."startedAt" DESC, d.id DESC LIMIT 1
    ) gaps ON true
    ORDER BY a.id
  `;

  const items = rows.slice(0, pageSize).map(({ candidateId, candidateName, gapStart, gapEnd, ...attempt }) => ({
    ...attempt,
    status: effectiveAttemptStatus(attempt.status, attempt.deadlineAt, serverTime),
    candidate: { id: candidateId, name: candidateName },
    disruptionCount: attempt.disruptionCount ?? 0,
    latestDisruption: gapStart ? { startedAt: gapStart, endedAt: gapEnd } : null,
  }));
  return {
    items,
    serverTime,
    meta: { pageSize, nextCursor: rows.length > pageSize ? items[items.length - 1].id : null },
  };
}
