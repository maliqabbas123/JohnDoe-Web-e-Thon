import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import type { AnnouncementCursor } from "./schemas";

const announcementView = { id: true, message: true, createdAt: true } as const;

export type Announcement = Prisma.AnnouncementGetPayload<{ select: typeof announcementView }>;

export function afterAnnouncement(cursor: AnnouncementCursor | undefined) {
  return cursor
    ? Prisma.sql`AND "createdAt" >= ${cursor.createdAt}
        AND ("createdAt", id) > (${cursor.createdAt}, ${cursor.id})`
    : Prisma.empty;
}

export function announcementCursor({ id, createdAt }: AnnouncementCursor): string {
  return Buffer.from(JSON.stringify([createdAt.toISOString(), id])).toString("base64url");
}

export async function assertExamOwner(examId: string, ownerId: string): Promise<void> {
  const owned = await db.exam.findFirst({ where: { id: examId, ownerId }, select: { id: true } });
  if (!owned) throw errors.notFound();
}

export async function listAnnouncements(
  examId: string, ownerId: string, pageSize: number, cursor?: AnnouncementCursor,
) {
  await assertExamOwner(examId, ownerId);
  const rows = await db.$queryRaw<Announcement[]>`
    SELECT id, message, "createdAt" FROM "Announcement"
    WHERE "examId" = ${examId} ${afterAnnouncement(cursor)}
    ORDER BY "createdAt", id
    LIMIT ${pageSize + 1}
  `;
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  return {
    items,
    meta: { pageSize, nextCursor: rows.length > pageSize && last ? announcementCursor(last) : null },
  };
}

export async function sendAnnouncement(examId: string, ownerId: string, message: string) {
  return db.$transaction(async (tx) => {
    // Publish in cursor order, even if two examiners' browser tabs send at
    // the same time or a server's clock moves backwards.
    const [exam] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Exam" WHERE id = ${examId} AND "ownerId" = ${ownerId}
      FOR NO KEY UPDATE
    `;
    if (!exam) throw errors.notFound();
    const previous = await tx.announcement.findFirst({
      where: { examId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const createdAt = new Date(Math.max(Date.now(), previous ? previous.createdAt.getTime() + 1 : 0));
    return tx.announcement.create({
      data: { examId, authorId: ownerId, message, createdAt },
      select: announcementView,
    });
  });
}
