import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Prisma, type Role } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import { gradedAttempts } from "@/server/modules/results/service";
import { buildReportPdf } from "./pdf";

const active = { revokedAt: null, supersededAt: null };
const fields = {
  id: true, attemptId: true, verificationCode: true, verificationUrl: true, issuedAt: true,
  score: true, maxScore: true,
} satisfies Prisma.ReportSelect;

function present({ score, maxScore, ...details }: Prisma.ReportGetPayload<{ select: typeof fields }>) {
  return { ...details, score: Number(score), maxScore: Number(maxScore) };
}

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function issueReport(examinerId: string, attemptId: string, requestOrigin: string, ip: string | null) {
  return db.$transaction(async (tx) => {
    // Grade corrections take the same attempt lock and supersede active reports.
    const [attempt] = await tx.$queryRaw<{
      examId: string; examTitle: string; candidateId: string; candidateName: string; score: number; maxScore: number;
    }[]>`
      SELECT e.id AS "examId", e.title AS "examTitle", u.id AS "candidateId", u.name AS "candidateName",
             a.score::float8, a."maxScore"::float8
      FROM "Attempt" a JOIN "Exam" e ON e.id = a."examId" JOIN "User" u ON u.id = a."userId"
      WHERE a.id = ${attemptId} AND e."ownerId" = ${examinerId} AND ${gradedAttempts}
        AND a."resultReleasedAt" IS NOT NULL
      FOR NO KEY UPDATE OF a
    `;
    if (!attempt) throw errors.notFound();

    const existing = await tx.report.findFirst({
      where: { attemptId, ...active, pdfBytes: { not: null } },
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }], select: fields,
    });
    if (existing) return { created: false, report: present(existing) };

    const issuedAt = new Date();
    const verificationCode = randomBytes(18).toString("base64url");
    const base = new URL(process.env.PUBLIC_BASE_URL || requestOrigin);
    if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("PUBLIC_BASE_URL must use HTTP or HTTPS");
    const verificationUrl = new URL(`/api/v1/verify/${verificationCode}`, base.origin).href;
    const pdf = await buildReportPdf({ ...attempt, attemptId, issuedAt, verificationUrl });
    await tx.report.updateMany({ where: { attemptId, ...active }, data: { supersededAt: issuedAt } });
    const report = await tx.report.create({
      data: {
        attemptId, verificationCode, verificationUrl, issuedAt, score: attempt.score, maxScore: attempt.maxScore,
        examTitle: attempt.examTitle, pdfBytes: Buffer.from(pdf), contentHash: digest(pdf), issuedById: examinerId,
      },
      select: fields,
    });
    await writeAudit({
      actorId: examinerId, action: "REPORT_ISSUED", entityType: "Report", entityId: report.id,
      metadata: { attemptId }, ip,
    }, tx);
    return { created: true, report: present(report) };
  });
}

export async function reportPdf(user: { id: string; role: Role }, attemptId: string) {
  const owner = user.role === "EXAMINER" ? { exam: { ownerId: user.id } } : { userId: user.id };
  const report = await db.report.findFirst({
    where: {
      attemptId, ...active, pdfBytes: { not: null },
      attempt: { isSandbox: false, resultReleasedAt: { not: null }, ...owner },
    },
    orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
    select: { pdfBytes: true, contentHash: true },
  });
  if (!report?.pdfBytes) throw errors.notFound();
  if (digest(report.pdfBytes) !== report.contentHash) throw new Error("Issued report bytes failed integrity verification");
  return report.pdfBytes;
}

export async function verifyReport(code: string) {
  const [report] = await db.$queryRaw<{
    validity: "VALID" | "SUPERSEDED" | "REVOKED";
    examTitle: string; score: number; issuedAt: Date;
  }[]>`
    SELECT CASE WHEN r."revokedAt" IS NOT NULL THEN 'REVOKED'
                WHEN r."supersededAt" IS NOT NULL THEN 'SUPERSEDED'
                ELSE 'VALID' END AS validity,
           coalesce(r."examTitle", e.title) AS "examTitle", r.score::float8, r."issuedAt"
    FROM "Report" r JOIN "Attempt" a ON a.id = r."attemptId" JOIN "Exam" e ON e.id = a."examId"
    WHERE r."verificationCode" = ${code} AND NOT a."isSandbox" AND a."resultReleasedAt" IS NOT NULL
  `;
  if (!report) throw errors.notFound();
  return report;
}
