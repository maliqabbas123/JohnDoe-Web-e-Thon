import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma, type Role } from "@/generated/prisma/client";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import { lockOwnedExamRow } from "@/server/modules/exams/access";
import type { CandidateRow } from "./candidate-rows";
import type { ImportRowError } from "./rows";
import { jobView } from "./service";

type Account = { id: string; email: string; role: Role; isActive: boolean };

export async function importCandidates(ownerId: string, examId: string, fileName: string, rows: CandidateRow[]) {
  const exam = await db.exam.findFirst({ where: { id: examId, ownerId }, select: { id: true } });
  if (!exam) throw errors.notFound("Exam not found.");

  const errorsByRow: ImportRowError[] = [];
  const records = new Map<string, { row: number; name: string }>();
  for (const entry of rows) {
    if (!("candidate" in entry)) {
      errorsByRow.push(entry);
    } else if (records.has(entry.candidate.email)) {
      errorsByRow.push({ row: entry.row, field: "email", message: "This address appears earlier in the file." });
    } else {
      records.set(entry.candidate.email, { row: entry.row, name: entry.candidate.name });
    }
  }

  const emails = [...records.keys()].sort();
  const known = emails.length ? await db.user.findMany({
    where: { email: { in: emails } }, select: { email: true },
  }) : [];
  const existing = new Set(known.map(({ email }) => email));
  // Hash outside the transaction so scrypt does not hold exam or user locks.
  const pending = await Promise.all(emails.filter((email) => !existing.has(email)).map(async (email) => {
    const password = randomBytes(18).toString("base64url");
    return { email, password, passwordHash: await hashPassword(password) };
  }));

  return db.$transaction(async (tx) => {
    await lockOwnedExamRow(tx, ownerId, examId);
    const created = pending.length ? await tx.user.createManyAndReturn({
      data: pending.map(({ email, passwordHash }) => ({
        email, passwordHash, name: records.get(email)!.name, role: "CANDIDATE",
      })),
      skipDuplicates: true,
      select: { id: true, email: true },
    }) : [];
    const accounts = emails.length ? await tx.$queryRaw<Account[]>`
      SELECT id, email, role, "isActive" FROM "User" WHERE email IN (${Prisma.join(emails)})
      ORDER BY email FOR SHARE
    ` : [];
    const byEmail = new Map(accounts.map((account) => [account.email, account]));
    const eligible: Account[] = [];
    for (const [email, entry] of records) {
      const account = byEmail.get(email);
      if (account?.role === "CANDIDATE" && account.isActive) {
        eligible.push(account);
      } else {
        errorsByRow.push({ row: entry.row, field: "email", message: "This address cannot be enrolled as a candidate." });
      }
    }
    if (eligible.length) {
      await tx.enrollment.createMany({
        data: eligible.map(({ id }) => ({ examId, candidateId: id, enrolledById: ownerId })),
        skipDuplicates: true,
      });
    }
    if (created.length) {
      await tx.auditLog.createMany({
        data: created.map(({ id, email }) => ({
          actorId: ownerId, action: "USER_CREATED", entityType: "User", entityId: id,
          metadata: { email, role: "CANDIDATE", examId },
        })),
      });
    }

    const job = await tx.importJob.create({
      data: {
        userId: ownerId, examId, kind: "CANDIDATES", fileName,
        totalRows: rows.length, successCount: eligible.length, failureCount: errorsByRow.length,
        errors: errorsByRow.sort((left, right) => left.row - right.row),
      },
      select: { ...jobView, examId: true },
    });

    // createManyAndReturn identifies the accounts created by this upload,
    // including when a signup or upload in another exam wins an email race.
    const createdEmails = new Set(created.map(({ email }) => email));
    const initialCredentials = pending.filter(({ email }) => createdEmails.has(email))
      .map(({ email, password }) => ({ row: records.get(email)!.row, email, password }))
      .sort((left, right) => left.row - right.row);
    return { job, initialCredentials };
  }, { timeout: 15_000 });
}
