import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { ListResultsInput } from "./schemas";
import { closedAttempts, gradedAttempts, ownedExam, resultOrder, resultPage } from "./service";

const MIN_OTHER_SCORES = 3;
const OUTLIER_DISTANCE = 0.15;

type ScoreStats = { count: number; mean: number | null; median: number | null; min: number | null; max: number | null };
type Bucket = { fromPercent: number; toPercent: number; count: number };
type Paper = {
  attemptId: string;
  questionCount: number;
  comparedQuestions: number;
  observedDifficulty: number | null;
  peerDifficulty: number | null;
  flag: "HARDER" | "EASIER" | null;
};

type ExamAnalyticsRow = {
  scores: ScoreStats;
  distribution: Bucket[];
  papers: Paper[];
  comparablePapers: number;
};

export async function examAnalytics(examinerId: string, examId: string, input: ListResultsInput) {
  const exam = await ownedExam(examId, examinerId);
  const cursor = input.cursor ? Prisma.sql`WHERE p."attemptId" > ${input.cursor}` : Prisma.empty;
  // Each question's observed mark fraction excludes the paper being measured.
  // Require enough scores for every question before comparing the paper.
  const [row] = await db.$queryRaw<ExamAnalyticsRow[]>`
    WITH attempts AS MATERIALIZED (
      SELECT a.id, a."userId", a."attemptNumber", a.score, a."maxScore"
      FROM "Attempt" a WHERE a."examId" = ${exam.id} AND ${gradedAttempts}
    ), result_scores AS (
      SELECT DISTINCT ON (a."userId") a.score, a."maxScore"
      FROM attempts a ORDER BY a."userId", ${resultOrder(Prisma.sql`${exam.resultPolicy}::text`)}
    ), stats AS (
      SELECT count(*)::int AS count, avg(score)::float8 AS mean,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY score) AS median,
             min(score)::float8 AS min, max(score)::float8 AS max
      FROM result_scores
    ), buckets AS (
      SELECT least(5, greatest(1, width_bucket(coalesce(score / nullif("maxScore", 0), 0), 0, 1, 5))) AS bucket,
             count(*)::int AS count
      FROM result_scores GROUP BY 1
    ), distribution AS (
      SELECT (n - 1) * 20 AS "fromPercent", n * 20 AS "toPercent", coalesce(b.count, 0) AS count
      FROM generate_series(1, 5) AS n LEFT JOIN buckets b ON b.bucket = n
    ), items AS MATERIALIZED (
      SELECT q."attemptId", q."questionId", q.marks::float8 AS marks,
             coalesce(q."manualScore", q."autoScore")::float8 / nullif(q.marks::float8, 0) AS fraction
      FROM attempts a JOIN "AttemptQuestion" q ON q."attemptId" = a.id
    ), item_stats AS (
      SELECT "questionId", count(fraction) AS samples, sum(fraction) AS sum
      FROM items GROUP BY "questionId"
    ), peer_items AS (
      SELECT i."attemptId", i.marks,
             CASE WHEN s.samples - (i.fraction IS NOT NULL)::int >= ${MIN_OTHER_SCORES}
                  THEN (s.sum - coalesce(i.fraction, 0)) / (s.samples - (i.fraction IS NOT NULL)::int)
             END AS fraction
      FROM items i JOIN item_stats s USING ("questionId")
    ), papers AS MATERIALIZED (
      SELECT "attemptId", count(*)::int AS "questionCount", count(fraction)::int AS "comparedQuestions",
             CASE WHEN count(fraction) = count(*)
                  THEN 1 - sum(fraction * marks) / nullif(sum(marks), 0)
             END AS "observedDifficulty"
      FROM peer_items GROUP BY "attemptId"
    ), cohort AS (
      SELECT count("observedDifficulty")::int AS comparable, sum("observedDifficulty") AS sum
      FROM papers
    ), page AS (
      SELECT p.*, (c.sum - p."observedDifficulty") / nullif(c.comparable - 1, 0) AS "peerDifficulty"
      FROM papers p CROSS JOIN cohort c ${cursor}
      ORDER BY p."attemptId" LIMIT ${input.pageSize + 1}
    ), compared AS (
      SELECT page.*,
             CASE WHEN "observedDifficulty" - "peerDifficulty" >= ${OUTLIER_DISTANCE} THEN 'HARDER'
                  WHEN "peerDifficulty" - "observedDifficulty" >= ${OUTLIER_DISTANCE} THEN 'EASIER'
             END AS flag
      FROM page
    )
    SELECT (SELECT row_to_json(s) FROM stats s) AS scores,
           (SELECT json_agg(d ORDER BY d."fromPercent") FROM distribution d) AS distribution,
           coalesce((SELECT json_agg(p ORDER BY p."attemptId") FROM compared p), '[]'::json) AS papers,
           (SELECT comparable FROM cohort) AS "comparablePapers"
  `;
  const { items, meta } = resultPage(row.papers, input.pageSize, (paper) => paper.attemptId);
  return {
    scores: { ...row.scores, distribution: row.distribution },
    fairness: {
      minimumOtherScores: MIN_OTHER_SCORES,
      outlierDistance: OUTLIER_DISTANCE,
      comparablePapers: row.comparablePapers,
      papers: items,
      meta,
    },
  };
}

type QuestionStats = {
  questionId: string;
  text: string;
  labelledDifficulty: "EASY" | "MEDIUM" | "HARD";
  served: number;
  skipped: number;
  correct: number | null;
  correctRate: number | null;
  averageTimeSeconds: number;
  meanMarkFraction: number | null;
  observedDifficulty: "EASY" | "MEDIUM" | "HARD" | null;
  mostChosenWrongOption: { id: string; text: string; count: number } | null;
};

export async function questionAnalytics(examinerId: string, examId: string, input: ListResultsInput) {
  const exam = await ownedExam(examId, examinerId);
  const cursor = input.cursor ? Prisma.sql`AND q."questionId" > ${input.cursor}` : Prisma.empty;
  // Fetch text and labels from one snapshot per question. Group identical
  // incorrect selections before expanding the frozen options.
  const rows = await db.$queryRaw<QuestionStats[]>`
    WITH attempts AS NOT MATERIALIZED (
      SELECT a.id, a."submittedAt" FROM "Attempt" a
      WHERE a."examId" = ${exam.id} AND ${closedAttempts}
    ), question_page AS MATERIALIZED (
      SELECT DISTINCT q."questionId"
      FROM attempts a JOIN "AttemptQuestion" q ON q."attemptId" = a.id
      WHERE TRUE ${cursor}
      ORDER BY q."questionId" LIMIT ${input.pageSize + 1}
    ), servings AS MATERIALIZED (
      SELECT q.id, q."questionId", q."attemptId", a."submittedAt",
             flags.written, q."selectedOptionIds", q."timeSpentSeconds",
             CASE WHEN flags.written THEN coalesce(q."writtenAnswer" ~ '[^[:space:]]', false)
                  ELSE flags.selected END AS answered,
             flags.full_credit,
             coalesce(q."manualScore", q."autoScore")::float8 / nullif(q.marks::float8, 0) AS fraction,
             CASE WHEN flags.may_have_wrong_options THEN q.snapshot->'options' END AS options,
             CASE WHEN flags.may_have_wrong_options THEN q.snapshot->'alsoAccepted' END AS accepted
      FROM question_page p JOIN "AttemptQuestion" q USING ("questionId")
      JOIN attempts a ON q."attemptId" = a.id
      CROSS JOIN LATERAL (
        SELECT q.snapshot->>'type' = 'WRITTEN' AS written,
               coalesce(cardinality(q."selectedOptionIds"), 0) > 0 AS selected,
               q."autoScore" = q.marks AS full_credit,
               q.snapshot->>'type' <> 'WRITTEN'
                 AND coalesce(cardinality(q."selectedOptionIds"), 0) > 0
                 AND (q.snapshot->>'type' <> 'SINGLE_CHOICE' OR q."autoScore" IS DISTINCT FROM q.marks)
                 AND coalesce(q.snapshot->>'voided', 'false') <> 'true' AS may_have_wrong_options
      ) flags
    ), latest AS (
      SELECT DISTINCT ON ("questionId") "questionId", id, written
      FROM servings ORDER BY "questionId", "submittedAt" DESC NULLS LAST, "attemptId" DESC
    ), stats AS (
      SELECT "questionId", count(*)::int AS served,
             count(*) FILTER (WHERE NOT answered)::int AS skipped,
             count(*) FILTER (WHERE NOT written AND answered AND full_credit)::int AS correct,
             avg("timeSpentSeconds")::float8 AS "averageTimeSeconds", avg(fraction) AS "meanMarkFraction"
      FROM servings GROUP BY "questionId"
    ), wrong_choices AS MATERIALIZED (
      SELECT "questionId", options, accepted, "selectedOptionIds", count(*) AS occurrences
      FROM servings WHERE options IS NOT NULL
      GROUP BY "questionId", options, accepted, "selectedOptionIds"
    ), wrong_options AS (
      SELECT s."questionId", opt.value->>'id' AS id, min(opt.value->>'text') AS text,
             sum(s.occurrences)::int AS count
      FROM wrong_choices s CROSS JOIN LATERAL jsonb_array_elements(s.options) opt
      WHERE opt.value->>'isCorrect' = 'false' AND opt.value->>'id' = ANY(s."selectedOptionIds")
        AND NOT coalesce(jsonb_path_exists(
          s.accepted, '$[*][*] ? (@ == $option)', jsonb_build_object('option', opt.value->>'id')
        ), false)
      GROUP BY s."questionId", opt.value->>'id'
    ), most_chosen AS (
      SELECT DISTINCT ON ("questionId") "questionId", id, text, count
      FROM wrong_options ORDER BY "questionId", count DESC, id
    )
    SELECT s."questionId", v.snapshot->>'text' AS text, v.snapshot->>'difficulty' AS "labelledDifficulty",
           s.served, s.skipped, s."averageTimeSeconds", s."meanMarkFraction",
           CASE WHEN NOT l.written THEN s.correct END AS correct,
           CASE WHEN NOT l.written THEN s.correct::float8 / s.served END AS "correctRate",
           CASE WHEN s."meanMarkFraction" >= 0.7 THEN 'EASY'
                WHEN s."meanMarkFraction" >= 0.4 THEN 'MEDIUM'
                WHEN s."meanMarkFraction" IS NOT NULL THEN 'HARD' END AS "observedDifficulty",
           CASE WHEN m.id IS NOT NULL THEN json_build_object('id', m.id, 'text', m.text, 'count', m.count)
           END AS "mostChosenWrongOption"
    FROM stats s JOIN latest l USING ("questionId")
    JOIN "AttemptQuestion" v ON v.id = l.id
    LEFT JOIN most_chosen m ON m."questionId" = s."questionId"
    ORDER BY s."questionId"
  `;
  return resultPage(rows, input.pageSize, (question) => question.questionId);
}
