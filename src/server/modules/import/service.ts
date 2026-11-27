import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { questionCreateData } from "@/server/modules/questions/service";
import type { ImportRowError, QuestionImportRow } from "./rows";
import type { ImportJobsQuery } from "./schemas";

const jobView = {
  id: true,
  kind: true,
  fileName: true,
  totalRows: true,
  successCount: true,
  failureCount: true,
  errors: true,
  createdAt: true,
} satisfies Prisma.ImportJobSelect;

export async function importQuestions(examiner: SessionUser, fileName: string, rows: QuestionImportRow[]) {
  const topicIds = [...new Set(rows.flatMap((entry) => "question" in entry ? [entry.question.topicId] : []))];

  return db.$transaction(async (tx) => {
    // Keep matched topics available through the insert, even when a delete
    // runs concurrently. A foreign topic and an absent topic look the same.
    const topics = topicIds.length
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "Topic"
          WHERE "ownerId" = ${examiner.id} AND id IN (${Prisma.join(topicIds)})
          ORDER BY id FOR KEY SHARE
        `
      : [];
    const ownedTopics = new Set(topics.map(({ id }) => id));
    const seen = new Set<string>();
    const rejected: ImportRowError[] = [];

    for (const entry of rows) {
      if (!("question" in entry)) {
        rejected.push(entry);
        continue;
      }

      const { question, row } = entry;
      if (!ownedTopics.has(question.topicId)) {
        rejected.push({ row, field: "topicId", message: "Choose one of your topics." });
        continue;
      }

      const data = questionCreateData(examiner.id, question);
      const key = JSON.stringify(data);
      if (seen.has(key)) {
        rejected.push({ row, field: "row", message: "This question duplicates an earlier row in the file." });
        continue;
      }
      seen.add(key);

      await tx.question.create({ data, select: { id: true } });
    }

    return tx.importJob.create({
      data: {
        userId: examiner.id,
        kind: "QUESTIONS",
        fileName,
        totalRows: rows.length,
        successCount: seen.size,
        failureCount: rejected.length,
        errors: rejected,
      },
      select: jobView,
    });
  }, { timeout: 15_000 });
}

export async function listImportJobs(examiner: SessionUser, { cursor, pageSize }: ImportJobsQuery) {
  const rows = await db.importJob.findMany({
    where: {
      userId: examiner.id,
      ...(cursor && {
        createdAt: { lte: cursor.createdAt },
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: pageSize + 1,
    select: jobView,
  });
  const items = rows.slice(0, pageSize);
  const last = items[items.length - 1];
  const nextCursor = rows.length > pageSize
    ? Buffer.from(JSON.stringify([last.createdAt.toISOString(), last.id])).toString("base64url")
    : null;
  return { items, meta: { pageSize, nextCursor } };
}
