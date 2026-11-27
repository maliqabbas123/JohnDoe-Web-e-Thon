import "server-only";
import type { AttemptStatus, ConnectionState } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import { afterAnnouncement, announcementCursor, type Announcement } from "./announcements";
import type { AnnouncementCursor } from "./schemas";

export const CONTACT_GAP_MS = 45_000;
const HEARTBEAT_PAGE_SIZE = 20;

type ContactRow = {
  status: AttemptStatus;
  connection: ConnectionState;
  lastSeenAt: Date;
  deadlineAt: Date;
  announcements: (Omit<Announcement, "createdAt"> & { createdAt: string })[];
};

export function effectiveAttemptStatus(status: AttemptStatus, deadlineAt: Date, now: Date): AttemptStatus {
  return status === "IN_PROGRESS" && deadlineAt <= now ? "EXPIRED" : status;
}

export async function heartbeat(attemptId: string, candidateId: string, cursor?: AnnouncementCursor) {
  return db.$transaction(async (tx) => {
    // The attempt lock serializes concurrent heartbeats, examiner sweeps
    // and attempt closure. Fetch announcements with the same indexed read.
    const [attempt] = await tx.$queryRaw<ContactRow[]>`
      SELECT a.status, a.connection, a."deadlineAt", a."lastSeenAt",
             COALESCE(messages.items, '[]'::json) AS announcements
      FROM "Attempt" a
      LEFT JOIN LATERAL (
        SELECT json_agg(n ORDER BY n."createdAt", n.id) AS items
        FROM (
          SELECT id, message, "createdAt" FROM "Announcement"
          WHERE "examId" = a."examId" ${afterAnnouncement(cursor)}
          ORDER BY "createdAt", id
          LIMIT ${HEARTBEAT_PAGE_SIZE + 1}
        ) n
      ) messages ON a.status = 'IN_PROGRESS' AND a."deadlineAt" > statement_timestamp()
      WHERE a.id = ${attemptId} AND a."userId" = ${candidateId} AND NOT a."isSandbox"
      FOR UPDATE OF a
    `;
    if (!attempt) throw errors.notFound();

    const serverTime = new Date();
    const status = effectiveAttemptStatus(attempt.status, attempt.deadlineAt, serverTime);
    const active = status === "IN_PROGRESS";
    if (active) {
      const seenAt = new Date(Math.max(serverTime.getTime(), attempt.lastSeenAt.getTime()));
      await tx.attempt.update({
        where: { id: attemptId },
        data: { lastSeenAt: seenAt, connection: "ONLINE" },
        select: { id: true },
      });
      if (attempt.connection === "INTERRUPTED") {
        await tx.disruption.updateMany({ where: { attemptId, endedAt: null }, data: { endedAt: seenAt } });
      } else if (seenAt.getTime() - attempt.lastSeenAt.getTime() > CONTACT_GAP_MS) {
        await tx.disruption.create({
          data: { attemptId, startedAt: attempt.lastSeenAt, endedAt: seenAt },
          select: { id: true },
        });
      }
    }

    const announcements = active
      ? attempt.announcements.slice(0, HEARTBEAT_PAGE_SIZE).map((entry) => ({
          ...entry, createdAt: new Date(entry.createdAt),
        }))
      : [];
    const last = announcements.at(-1) ?? cursor;
    return {
      serverTime,
      deadlineAt: attempt.deadlineAt,
      status,
      announcements,
      announcementCursor: last ? announcementCursor(last) : null,
      hasMoreAnnouncements: active && attempt.announcements.length > HEARTBEAT_PAGE_SIZE,
    };
  });
}

export async function sweepDisruptions(examId: string, now: Date) {
  const cutoff = new Date(now.getTime() - CONTACT_GAP_MS);
  await db.$transaction(async (tx) => {
    const interrupted = await tx.$queryRaw<{ attemptId: string; startedAt: Date }[]>`
      WITH stale AS (
        SELECT id FROM "Attempt"
        WHERE "examId" = ${examId} AND status = 'IN_PROGRESS' AND connection = 'ONLINE'
          AND NOT "isSandbox" AND "deadlineAt" > ${now} AND "lastSeenAt" < ${cutoff}
        ORDER BY id FOR UPDATE
      )
      UPDATE "Attempt" a SET connection = 'INTERRUPTED'
      FROM stale WHERE a.id = stale.id
      RETURNING a.id AS "attemptId", a."lastSeenAt" AS "startedAt"
    `;
    if (interrupted.length) await tx.disruption.createMany({ data: interrupted });
  });
}
