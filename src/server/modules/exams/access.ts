import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { errors } from "@/server/http/errors";

// All exam mutations take this lock before checking attempts or enrolments.
export async function lockOwnedExamRow(tx: Prisma.TransactionClient, ownerId: string, id: string) {
  const [exam] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Exam" WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE
  `;
  if (!exam) throw errors.notFound("Exam not found.");
}
