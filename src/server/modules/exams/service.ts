import "server-only";
import { randomBytes } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { writeAudit } from "@/server/audit/audit";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { calculateExamState, examRules, type ExamState } from "@/server/exam/rules";
import { errors } from "@/server/http/errors";
import { reviewPaper, slotProblems } from "./review";
import type { CreateExamInput, DifficultyRulesInput, ListExamsInput, QuestionPoolInput, UpdateExamInput } from "./schemas";

const summarySelect = {
  id: true,
  title: true,
  startsAt: true,
  endsAt: true,
  status: true,
  durationMinutes: true,
  totalMarks: true,
  selectionMode: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExamSelect;

const reviewQuestionSelect = {
  marks: true,
  question: { select: { difficulty: true, isArchived: true } },
} satisfies Prisma.ExamQuestionSelect;

const poolSelect = {
  ...reviewQuestionSelect,
  questionId: true,
  position: true,
} satisfies Prisma.ExamQuestionSelect;

const difficultySelect = {
  difficulty: true,
  percent: true,
  marksEach: true,
} satisfies Prisma.ExamDifficultyRuleSelect;

const reviewSelect = {
  startsAt: true,
  endsAt: true,
  durationMinutes: true,
  totalMarks: true,
  selectionMode: true,
  questionCount: true,
  questions: { select: reviewQuestionSelect },
  difficultyRules: { select: difficultySelect },
} satisfies Prisma.ExamSelect;

const detailSelect = {
  ...summarySelect,
  instructions: true,
  questionCount: true,
  shuffleQuestions: true,
  shuffleOptions: true,
  multiSelectScoring: true,
  maxAttempts: true,
  resultPolicy: true,
  disputeWindowHours: true,
  revealAnswers: true,
  desktopOnly: true,
  blockClipboard: true,
  blockContextMenu: true,
  requireFullscreen: true,
  detectExtraDisplay: true,
  watermark: true,
  aiNotice: true,
  honeypot: true,
  publishedAt: true,
  completedAt: true,
  joinCode: true,
  questions: { select: poolSelect, orderBy: { position: "asc" } },
  difficultyRules: { select: difficultySelect, orderBy: { difficulty: "asc" } },
} satisfies Prisma.ExamSelect;

type ExamSummary = Prisma.ExamGetPayload<{ select: typeof summarySelect }>;
type ExamDetail = Prisma.ExamGetPayload<{ select: typeof detailSelect }>;
type Tx = Prisma.TransactionClient;

function presentSummary(exam: ExamSummary, now: Date) {
  return { ...exam, totalMarks: Number(exam.totalMarks), state: calculateExamState(exam, now) };
}

function presentPool(questions: ExamDetail["questions"]) {
  return questions.map(({ marks, ...question }) => ({
    ...question,
    marks: marks === null ? null : Number(marks),
  }));
}

function presentDifficultyRules(rules: ExamDetail["difficultyRules"]) {
  return rules.map(({ marksEach, ...rule }) => ({ ...rule, marksEach: Number(marksEach) }));
}

function presentDetail(exam: ExamDetail, now: Date) {
  return {
    ...presentSummary(exam, now),
    questions: presentPool(exam.questions),
    difficultyRules: presentDifficultyRules(exam.difficultyRules),
    rules: examRules(exam),
  };
}

function stateFilter(state: ExamState | undefined, now: Date): Prisma.ExamWhereInput {
  switch (state) {
    case "DRAFT": return { status: "DRAFT" };
    case "PUBLISHED": return { status: "PUBLISHED", startsAt: { gt: now } };
    case "ONGOING": return { status: "PUBLISHED", startsAt: { lte: now }, endsAt: { gte: now } };
    case "COMPLETED": return {
      OR: [{ status: "COMPLETED" }, { status: "PUBLISHED", endsAt: { lt: now } }],
    };
    default: return {};
  }
}

export async function listExams(owner: SessionUser, { page, pageSize, state }: ListExamsInput) {
  const now = new Date();
  const where = { ownerId: owner.id, ...stateFilter(state, now) };
  const [exams, total] = await db.$transaction([
    db.exam.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: summarySelect,
    }),
    db.exam.count({ where }),
  ], { isolationLevel: "RepeatableRead" });
  return { items: exams.map((exam) => presentSummary(exam, now)), meta: { page, pageSize, total } };
}

async function readExam(client: Tx, ownerId: string, id: string) {
  const exam = await client.exam.findFirst({ where: { id, ownerId }, select: detailSelect });
  if (!exam) throw errors.notFound("Exam not found.");
  return exam;
}

export async function getExam(owner: SessionUser, id: string) {
  const exam = await db.$transaction(
    (tx) => readExam(tx, owner.id, id),
    { isolationLevel: "RepeatableRead" },
  );
  return presentDetail(exam, new Date());
}

function readExamForReview(tx: Tx, ownerId: string, id: string) {
  return tx.exam.findUniqueOrThrow({ where: { id, ownerId }, select: reviewSelect });
}

export async function reviewExam(owner: SessionUser, id: string) {
  const exam = await db.$transaction(
    (tx) => readExamForReview(tx, owner.id, id),
    { isolationLevel: "RepeatableRead" },
  );
  return reviewPaper(exam, new Date());
}

function assertSlot(exam: Pick<ExamSummary, "startsAt" | "endsAt" | "durationMinutes">) {
  const problems = slotProblems(exam);
  if (problems.length > 0) throw errors.validation(problems);
}

export async function createExam(owner: SessionUser, input: CreateExamInput) {
  assertSlot(input);
  const exam = await db.exam.create({ data: { ownerId: owner.id, ...input }, select: detailSelect });
  return presentDetail(exam, new Date());
}

// Lock before reading settings or checking for attempts. Attempt creation
// must take the same exam row lock before it checks eligibility or draws a
// paper so it cannot start using settings that just changed.
async function lockOwnedExam(tx: Tx, ownerId: string, id: string) {
  const [exam] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Exam" WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE
  `;
  if (!exam) throw errors.notFound("Exam not found.");
  return tx.exam.findUniqueOrThrow({ where: { id }, select: summarySelect });
}

async function hasAttempts(tx: Tx, examId: string) {
  return await tx.attempt.findFirst({ where: { examId }, select: { id: true } }) !== null;
}

async function assertPaperEditable(tx: Tx, exam: ExamSummary) {
  if (await hasAttempts(tx, exam.id)) {
    throw errors.conflict("The slot and paper settings are locked after an attempt exists.");
  }
  if (exam.status !== "DRAFT" && calculateExamState(exam) !== "PUBLISHED") {
    throw errors.conflict("The slot and paper settings are locked once a published exam starts or is closed.");
  }
}

const editableAfterStart = new Set<keyof UpdateExamInput>([
  "instructions", "maxAttempts", "resultPolicy", "disputeWindowHours", "revealAnswers",
]);

async function assertPublishable(tx: Tx, ownerId: string, id: string) {
  // A bank edit can affect the paper until it starts. Keep those rows stable
  // between validation and commit, including when running the checks on an edit.
  await tx.$queryRaw`
    SELECT q.id FROM "Question" q
    JOIN "ExamQuestion" pool ON pool."questionId" = q.id
    WHERE pool."examId" = ${id}
    ORDER BY q.id FOR SHARE OF q
  `;
  const exam = await readExamForReview(tx, ownerId, id);
  const now = new Date();
  const review = reviewPaper(exam, now);
  if (!review.canPublish) throw errors.validation(review.errors, "The exam is not ready to publish.");
  return now;
}

export async function updateExam(owner: SessionUser, id: string, input: UpdateExamInput) {
  return db.$transaction(async (tx) => {
    const exam = await lockOwnedExam(tx, owner.id, id);
    const settingsChanged = (Object.keys(input) as (keyof UpdateExamInput)[])
      .some((key) => !editableAfterStart.has(key));
    if (settingsChanged) {
      await assertPaperEditable(tx, exam);
      assertSlot({ ...exam, ...input });
    }

    const switchedModes = input.selectionMode !== undefined && input.selectionMode !== exam.selectionMode;
    if (switchedModes && input.selectionMode === "BALANCED") {
      await tx.examQuestion.updateMany({ where: { examId: id }, data: { marks: null } });
    }
    if (switchedModes && input.selectionMode === "FIXED") {
      await tx.examDifficultyRule.deleteMany({ where: { examId: id } });
    }
    await tx.exam.update({
      where: { id },
      data: { ...input, ...(switchedModes && input.selectionMode === "FIXED" ? { questionCount: null } : {}) },
      select: { id: true },
    });

    if (settingsChanged && exam.status === "PUBLISHED") await assertPublishable(tx, owner.id, id);
    return presentDetail(await readExam(tx, owner.id, id), new Date());
  });
}

export async function replaceQuestionPool(owner: SessionUser, id: string, { questions }: QuestionPoolInput) {
  return db.$transaction(async (tx) => {
    const exam = await lockOwnedExam(tx, owner.id, id);
    await assertPaperEditable(tx, exam);

    const ids = questions.map(({ questionId }) => questionId);
    const available = ids.length === 0 ? [] : await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Question"
      WHERE id IN (${Prisma.join(ids)}) AND "ownerId" = ${owner.id} AND NOT "isArchived"
      ORDER BY id FOR SHARE
    `;
    const availableIds = new Set(available.map((question) => question.id));
    const problems = questions.flatMap(({ questionId, marks }, index) => {
      if (!availableIds.has(questionId)) {
        return [{ path: `questions.${index}.questionId`, message: "Choose an active question from your question bank." }];
      }
      if (exam.selectionMode === "FIXED" && marks == null) {
        return [{ path: `questions.${index}.marks`, message: "Enter the marks for this question." }];
      }
      if (exam.selectionMode === "BALANCED" && marks != null) {
        return [{ path: `questions.${index}.marks`, message: "Set marks in the difficulty rules for balanced papers." }];
      }
      return [];
    });
    if (problems.length > 0) throw errors.validation(problems);

    await tx.examQuestion.deleteMany({ where: { examId: id } });
    if (questions.length > 0) {
      await tx.examQuestion.createMany({
        data: questions.map(({ questionId, marks }, index) => ({
          examId: id, questionId, marks: marks ?? null, position: index + 1,
        })),
      });
    }
    await tx.exam.update({ where: { id }, data: { updatedAt: new Date() }, select: { id: true } });
    if (exam.status === "PUBLISHED") await assertPublishable(tx, owner.id, id);
    const saved = await tx.examQuestion.findMany({
      where: { examId: id }, select: poolSelect, orderBy: { position: "asc" },
    });
    return { questions: presentPool(saved) };
  });
}

export async function replaceDifficultyRules(owner: SessionUser, id: string, { questionCount, rules }: DifficultyRulesInput) {
  return db.$transaction(async (tx) => {
    const exam = await lockOwnedExam(tx, owner.id, id);
    await assertPaperEditable(tx, exam);
    if (exam.selectionMode !== "BALANCED") throw errors.conflict("Difficulty rules require balanced selection.");

    await tx.examDifficultyRule.deleteMany({ where: { examId: id } });
    await tx.examDifficultyRule.createMany({ data: rules.map((rule) => ({ examId: id, ...rule })) });
    await tx.exam.update({ where: { id }, data: { questionCount }, select: { id: true } });
    if (exam.status === "PUBLISHED") await assertPublishable(tx, owner.id, id);
    const saved = await tx.examDifficultyRule.findMany({
      where: { examId: id }, select: difficultySelect, orderBy: { difficulty: "asc" },
    });
    return { questionCount, difficultyRules: presentDifficultyRules(saved) };
  });
}

export async function publishExam(owner: SessionUser, id: string) {
  return db.$transaction(async (tx) => {
    const exam = await lockOwnedExam(tx, owner.id, id);
    if (exam.status !== "DRAFT") throw errors.conflict("Only a draft exam can be published.");
    const now = await assertPublishable(tx, owner.id, id);
    const updated = await tx.exam.update({
      where: { id }, data: { status: "PUBLISHED", publishedAt: now }, select: summarySelect,
    });
    await writeAudit({ actorId: owner.id, action: "EXAM_PUBLISHED", entityType: "Exam", entityId: id }, tx);
    return presentSummary(updated, now);
  });
}

export async function unpublishExam(owner: SessionUser, id: string) {
  return db.$transaction(async (tx) => {
    const exam = await lockOwnedExam(tx, owner.id, id);
    if (exam.status !== "PUBLISHED" || await hasAttempts(tx, id) || new Date() >= exam.startsAt) {
      throw errors.conflict("Only a published exam whose slot has not started and has no attempts can be unpublished.");
    }
    const updated = await tx.exam.update({
      where: { id }, data: { status: "DRAFT", publishedAt: null }, select: summarySelect,
    });
    await writeAudit({ actorId: owner.id, action: "EXAM_UNPUBLISHED", entityType: "Exam", entityId: id }, tx);
    return presentSummary(updated, new Date());
  });
}

export async function completeExam(owner: SessionUser, id: string) {
  return db.$transaction(async (tx) => {
    const exam = await lockOwnedExam(tx, owner.id, id);
    if (exam.status !== "PUBLISHED") throw errors.conflict("Only a published exam can be completed.");
    const now = new Date();
    const activeAttempt = await tx.attempt.findFirst({
      where: { examId: id, isSandbox: false, retakeGrantId: null, status: "IN_PROGRESS", deadlineAt: { gt: now } },
      select: { id: true },
    });
    if (activeAttempt) throw errors.conflict("Wait for active attempts in the main slot to finish.");
    const updated = await tx.exam.update({
      where: { id }, data: { status: "COMPLETED", completedAt: now }, select: summarySelect,
    });
    await writeAudit({ actorId: owner.id, action: "EXAM_COMPLETED", entityType: "Exam", entityId: id }, tx);
    return presentSummary(updated, now);
  });
}

export async function rotateJoinCode(owner: SessionUser, id: string) {
  const joinCode = randomBytes(16).toString("hex");
  return db.exam.update({
    where: { id, ownerId: owner.id },
    data: { joinCode },
    select: { joinCode: true },
  });
}

export async function disableJoinCode(owner: SessionUser, id: string) {
  await db.exam.update({
    where: { id, ownerId: owner.id }, data: { joinCode: null }, select: { id: true },
  });
}
