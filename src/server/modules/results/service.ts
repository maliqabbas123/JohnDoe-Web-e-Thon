import "server-only";
import { Prisma, type AttemptStatus, type GradingStatus, type ResultPolicy } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import { db } from "@/server/db";
import { effectiveScore, toCandidateQuestion, type PaperSnapshot } from "@/server/exam/paper";
import { errors } from "@/server/http/errors";
import type { ListResultsInput, MyResultsInput } from "./schemas";

export const closedAttempts = Prisma.sql`a.status IN ('SUBMITTED', 'EXPIRED') AND NOT a."isSandbox"`;
export const gradedAttempts = Prisma.sql`${closedAttempts} AND a."gradingStatus" = 'GRADED' AND a.score IS NOT NULL`;

// All selections rank eligible attempts by the same rule. Attempt numbers
// identify the order in which a candidate started their attempts.
export function resultOrder(policy: Prisma.Sql) {
  return Prisma.sql`
    CASE WHEN ${policy} = 'BEST' THEN a.score END DESC NULLS LAST,
    CASE WHEN ${policy} = 'BEST' THEN a."attemptNumber" END ASC,
    a."attemptNumber" DESC
  `;
}

export async function ownedExam(examId: string, examinerId: string) {
  const exam = await db.exam.findFirst({
    where: { id: examId, ownerId: examinerId },
    select: { id: true, resultPolicy: true },
  });
  if (!exam) throw errors.notFound();
  return exam;
}

export function resultPage<T>(rows: T[], pageSize: number, cursorFor: (row: T) => string) {
  const items = rows.slice(0, pageSize);
  return {
    items,
    meta: { pageSize, nextCursor: rows.length > pageSize ? cursorFor(items[pageSize - 1]) : null },
  };
}

type AttemptResult = {
  attemptId: string;
  attemptNumber: number;
  status: AttemptStatus;
  gradingStatus: GradingStatus;
  submittedAt: Date;
  score: number | null;
  maxScore: number;
  resultReleasedAt: Date | null;
};

type ResultRow = { candidateId: string; candidateName: string } & (AttemptResult | { attemptId: null });

export async function listExamResults(examinerId: string, examId: string, input: ListResultsInput) {
  const exam = await ownedExam(examId, examinerId);
  const cursor = input.cursor ? Prisma.sql`AND e."candidateId" > ${input.cursor}` : Prisma.empty;
  const rows = await db.$queryRaw<ResultRow[]>`
    SELECT c.id AS "candidateId", c.name AS "candidateName",
           result."attemptId", result."attemptNumber", result.status, result."gradingStatus",
           result."submittedAt", result.score, result."maxScore", result."resultReleasedAt"
    FROM "Enrollment" e
    JOIN "User" c ON c.id = e."candidateId"
    LEFT JOIN LATERAL (
      SELECT a.id AS "attemptId", a."attemptNumber", a.status, a."gradingStatus", a."submittedAt",
             a.score::float8, a."maxScore"::float8, a."resultReleasedAt"
      FROM "Attempt" a
      WHERE a."examId" = e."examId" AND a."userId" = e."candidateId" AND ${closedAttempts}
      ORDER BY (a."gradingStatus" = 'GRADED' AND a.score IS NOT NULL) DESC,
               CASE WHEN a."gradingStatus" <> 'GRADED' OR a.score IS NULL THEN a."attemptNumber" END DESC NULLS LAST,
               ${resultOrder(Prisma.sql`${exam.resultPolicy}::text`)}
      LIMIT 1
    ) result ON true
    WHERE e."examId" = ${exam.id} ${cursor}
    ORDER BY e."candidateId"
    LIMIT ${input.pageSize + 1}
  `;
  const { items, meta } = resultPage(rows, input.pageSize, (row) => row.candidateId);
  return {
    items: items.map(({ candidateId, candidateName, ...result }) => ({
      candidate: { id: candidateId, name: candidateName },
      result: result.attemptId === null ? null : result,
    })),
    meta,
  };
}

type ReleaseCounts = { released: number; alreadyReleased: number; needsReview: number };

export async function releaseExamResults(examinerId: string, examId: string, ip: string | null) {
  return db.$transaction(async (tx) => {
    // Serialize releases and policy edits. Lock attempts in a fixed order
    // so ranking and publication see the same scores as concurrent graders.
    const [exam] = await tx.$queryRaw<{ resultPolicy: ResultPolicy }[]>`
      SELECT "resultPolicy" FROM "Exam"
      WHERE id = ${examId} AND "ownerId" = ${examinerId}
      FOR NO KEY UPDATE
    `;
    if (!exam) throw errors.notFound();

    const releasedAt = new Date();
    const [counts] = await tx.$queryRaw<ReleaseCounts[]>`
      WITH locked AS MATERIALIZED (
        SELECT a.id, a."userId", a."attemptNumber", a."gradingStatus", a.score, a."resultReleasedAt"
        FROM "Attempt" a
        WHERE a."examId" = ${examId} AND ${closedAttempts}
        ORDER BY a.id
        FOR NO KEY UPDATE
      ), chosen AS MATERIALIZED (
        SELECT DISTINCT ON (a."userId") a.id, a."resultReleasedAt"
        FROM locked a
        WHERE a."gradingStatus" = 'GRADED' AND a.score IS NOT NULL
        ORDER BY a."userId", ${resultOrder(Prisma.sql`${exam.resultPolicy}::text`)}
      ), published AS (
        UPDATE "Attempt" a SET "resultReleasedAt" = ${releasedAt}
        FROM chosen
        WHERE a.id = chosen.id AND a."resultReleasedAt" IS NULL
        RETURNING a.id
      )
      SELECT (SELECT count(*)::int FROM published) AS released,
             (SELECT count(*)::int FROM chosen WHERE "resultReleasedAt" IS NOT NULL) AS "alreadyReleased",
             (SELECT count(*)::int FROM locked WHERE "gradingStatus" = 'NEEDS_REVIEW') AS "needsReview"
    `;
    if (counts.released > 0) {
      await tx.exam.updateMany({
        where: { id: examId, resultsPublishedAt: null },
        data: { resultsPublishedAt: releasedAt },
      });
      await writeAudit({
        actorId: examinerId,
        action: "RESULT_RELEASED",
        entityType: "Exam",
        entityId: examId,
        metadata: counts,
        ip,
      }, tx);
    }
    return { ...counts, releasedAt: counts.released > 0 ? releasedAt : null };
  });
}

type ReleasedResult = Pick<AttemptResult, "attemptId" | "attemptNumber" | "submittedAt" | "maxScore"> & {
  examId: string;
  examTitle: string;
  score: number;
  resultReleasedAt: Date;
};

function candidateResult({ examId, examTitle, ...result }: ReleasedResult) {
  return { ...result, exam: { id: examId, title: examTitle } };
}

export async function listCandidateResults(candidateId: string, input: MyResultsInput) {
  const cursor = input.cursor
    ? Prisma.sql`WHERE ("resultReleasedAt", "attemptId") < (${input.cursor[0]}, ${input.cursor[1]})`
    : Prisma.empty;
  const rows = await db.$queryRaw<ReleasedResult[]>`
    WITH chosen AS (
      SELECT DISTINCT ON (a."examId") a.id AS "attemptId", a."attemptNumber", a."submittedAt",
             a.score::float8, a."maxScore"::float8, a."resultReleasedAt",
             e.id AS "examId", e.title AS "examTitle"
      FROM "Attempt" a JOIN "Exam" e ON e.id = a."examId"
      WHERE a."userId" = ${candidateId} AND ${gradedAttempts} AND a."resultReleasedAt" IS NOT NULL
      ORDER BY a."examId", ${resultOrder(Prisma.sql`e."resultPolicy"`)}
    )
    SELECT * FROM chosen ${cursor}
    ORDER BY "resultReleasedAt" DESC, "attemptId" DESC
    LIMIT ${input.pageSize + 1}
  `;
  const { items, meta } = resultPage(rows, input.pageSize, (row) =>
    Buffer.from(JSON.stringify([row.resultReleasedAt, row.attemptId])).toString("base64url"),
  );
  return { items: items.map(candidateResult), meta };
}

export async function candidateResultDetail(candidateId: string, attemptId: string) {
  // Keep the grade and the reviewed answers on the same database snapshot.
  return db.$transaction(async (tx) => {
    const [result] = await tx.$queryRaw<(ReleasedResult & { revealAnswers: boolean })[]>`
      SELECT a.id AS "attemptId", a."attemptNumber", a."submittedAt", a.score::float8, a."maxScore"::float8,
             a."resultReleasedAt", e.id AS "examId", e.title AS "examTitle", e."revealAnswers"
      FROM "Attempt" a JOIN "Exam" e ON e.id = a."examId"
      WHERE a.id = ${attemptId} AND a."userId" = ${candidateId}
        AND ${gradedAttempts} AND a."resultReleasedAt" IS NOT NULL
    `;
    if (!result) throw errors.notFound();

    const { revealAnswers, ...summary } = result;
    const rows = await tx.attemptQuestion.findMany({
      where: { attemptId },
      orderBy: { position: "asc" },
      select: {
        position: true,
        marks: true,
        snapshot: true,
        optionOrder: true,
        selectedOptionIds: true,
        writtenAnswer: true,
        autoScore: true,
        manualScore: true,
        feedback: true,
      },
    });
    const questions = rows.map(({ snapshot, marks, optionOrder, autoScore, manualScore, ...answer }) => {
      const paper = snapshot as unknown as PaperSnapshot;
      return {
        ...toCandidateQuestion(paper, optionOrder),
        ...answer,
        marks: Number(marks),
        score: effectiveScore(autoScore === null ? null : Number(autoScore), manualScore === null ? null : Number(manualScore)),
        ...(revealAnswers && paper.type !== "WRITTEN" ? {
          answerKey: {
            correctOptionIds: paper.options.filter((option) => option.isCorrect).map((option) => option.id),
            alsoAccepted: paper.alsoAccepted ?? [],
            voided: paper.voided ?? false,
          },
        } : {}),
      };
    });
    return { ...candidateResult(summary), revealAnswers, questions };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
