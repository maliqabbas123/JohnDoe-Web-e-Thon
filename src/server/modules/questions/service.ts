import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { errors } from "@/server/http/errors";
import {
  optionProblems,
  type CreateQuestionInput,
  type ListQuestionsInput,
  type OptionInput,
  type TopicInput,
  type UpdateQuestionInput,
} from "./schemas";

// A question bank belongs to one examiner. Every query here is scoped by
// ownerId, so another examiner's topic or question is simply "not found":
// the response never confirms that it exists.

// ───────────────────────── Topics ─────────────────────────

async function assertTopicNameFree(ownerId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await db.topic.findFirst({
    where: {
      ownerId,
      name: { equals: name, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (clash) throw errors.conflict("You already have a topic with this name.");
}

// Topics with how many usable questions each holds per difficulty, which is
// what an examiner needs to plan an exam's difficulty mix. Two queries
// regardless of how many topics there are.
export async function listTopics(owner: SessionUser) {
  const [topics, counts] = await Promise.all([
    db.topic.findMany({
      where: { ownerId: owner.id },
      select: { id: true, name: true, createdAt: true },
      orderBy: { name: "asc" },
    }),
    db.question.groupBy({
      by: ["topicId", "difficulty"],
      where: { ownerId: owner.id, isArchived: false },
      _count: { _all: true },
    }),
  ]);

  return topics.map((topic) => {
    const byDifficulty = { EASY: 0, MEDIUM: 0, HARD: 0 };
    for (const row of counts) {
      if (row.topicId === topic.id) byDifficulty[row.difficulty] = row._count._all;
    }
    return {
      ...topic,
      questionCount: byDifficulty.EASY + byDifficulty.MEDIUM + byDifficulty.HARD,
      byDifficulty,
    };
  });
}

export async function createTopic(owner: SessionUser, input: TopicInput) {
  await assertTopicNameFree(owner.id, input.name);
  return db.topic.create({
    data: { ownerId: owner.id, name: input.name },
    select: { id: true, name: true, createdAt: true },
  });
}

export async function renameTopic(owner: SessionUser, id: string, input: TopicInput) {
  const topic = await db.topic.findFirst({ where: { id, ownerId: owner.id }, select: { id: true } });
  if (!topic) throw errors.notFound("Topic not found.");
  await assertTopicNameFree(owner.id, input.name, id);
  return db.topic.update({
    where: { id },
    data: { name: input.name },
    select: { id: true, name: true, createdAt: true },
  });
}

export async function deleteTopic(owner: SessionUser, id: string): Promise<void> {
  const topic = await db.topic.findFirst({
    where: { id, ownerId: owner.id },
    select: { id: true, _count: { select: { questions: true } } },
  });
  if (!topic) throw errors.notFound("Topic not found.");
  if (topic._count.questions > 0) {
    throw errors.conflict("Move or delete the questions in this topic first.");
  }
  await db.topic.delete({ where: { id } });
}

// ───────────────────────── Questions ─────────────────────────

// The examiner's view of a question, including the answer key. Nothing in
// this module is reachable by a candidate.
const questionView = {
  id: true,
  type: true,
  difficulty: true,
  text: true,
  explanation: true,
  defaultMarks: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  topic: { select: { id: true, name: true } },
  options: {
    select: { id: true, text: true, isCorrect: true, position: true },
    orderBy: { position: "asc" },
  },
  _count: { select: { examQuestions: true } },
} satisfies Prisma.QuestionSelect;

type QuestionRow = Prisma.QuestionGetPayload<{ select: typeof questionView }>;

function present({ _count, defaultMarks, ...question }: QuestionRow) {
  return {
    ...question,
    // Stored as an exact decimal; two decimal places are safe as a number.
    defaultMarks: Number(defaultMarks),
    // How many exams use the question, so the examiner knows before editing.
    usedInExams: _count.examQuestions,
  };
}

const literal = (term: string) => term.replace(/[\\%_]/g, "\\$&");

async function assertOwnTopic(ownerId: string, topicId: string): Promise<void> {
  const topic = await db.topic.findFirst({ where: { id: topicId, ownerId }, select: { id: true } });
  if (!topic) throw errors.validation([{ path: "topicId", message: "Choose one of your topics." }]);
}

const optionRows = (options: OptionInput[] | undefined) =>
  (options ?? []).map((option, index) => ({
    text: option.text,
    isCorrect: option.isCorrect,
    position: index + 1,
  }));

export async function listQuestions(owner: SessionUser, filters: ListQuestionsInput) {
  const where: Prisma.QuestionWhereInput = {
    ownerId: owner.id,
    isArchived: filters.isArchived,
    ...(filters.topicId ? { topicId: filters.topicId } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.difficulty ? { difficulty: filters.difficulty } : {}),
    ...(filters.q ? { text: { contains: literal(filters.q), mode: "insensitive" } } : {}),
  };

  const [rows, total] = await Promise.all([
    db.question.findMany({
      where,
      select: questionView,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    db.question.count({ where }),
  ]);

  return {
    items: rows.map(present),
    meta: { page: filters.page, pageSize: filters.pageSize, total },
  };
}

export async function getQuestion(owner: SessionUser, id: string) {
  const question = await db.question.findFirst({ where: { id, ownerId: owner.id }, select: questionView });
  if (!question) throw errors.notFound("Question not found.");
  return present(question);
}

export async function createQuestion(owner: SessionUser, input: CreateQuestionInput) {
  await assertOwnTopic(owner.id, input.topicId);

  const question = await db.question.create({
    data: {
      ownerId: owner.id,
      topicId: input.topicId,
      type: input.type,
      difficulty: input.difficulty,
      text: input.text,
      explanation: input.explanation || null,
      defaultMarks: input.defaultMarks,
      options: { create: optionRows(input.options) },
    },
    select: questionView,
  });
  return present(question);
}

// Editing is always allowed. An attempt works from the copy of the question
// taken when it started, so a later edit never changes a paper already
// being sat or how it was graded.
export async function updateQuestion(owner: SessionUser, id: string, input: UpdateQuestionInput) {
  const existing = await db.question.findFirst({
    where: { id, ownerId: owner.id },
    select: { id: true, type: true },
  });
  if (!existing) throw errors.notFound("Question not found.");

  if (input.options !== undefined) {
    const problems = optionProblems(existing.type, input.options);
    if (problems.length > 0) throw errors.validation(problems);
  }
  if (input.topicId !== undefined) await assertOwnTopic(owner.id, input.topicId);

  const question = await db.$transaction(async (tx) => {
    if (input.options !== undefined) {
      // The option set is replaced as a whole, so positions stay contiguous.
      await tx.questionOption.deleteMany({ where: { questionId: id } });
    }
    return tx.question.update({
      where: { id },
      data: {
        ...(input.topicId !== undefined ? { topicId: input.topicId } : {}),
        ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.explanation !== undefined ? { explanation: input.explanation || null } : {}),
        ...(input.defaultMarks !== undefined ? { defaultMarks: input.defaultMarks } : {}),
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(input.options !== undefined ? { options: { create: optionRows(input.options) } } : {}),
      },
      select: questionView,
    });
  });
  return present(question);
}

// A question that was never used disappears. One that is in an exam's pool
// or in someone's paper is archived instead: history must stay readable.
export async function removeQuestion(owner: SessionUser, id: string) {
  return db.$transaction(async (tx) => {
    const question = await tx.question.findFirst({
      where: { id, ownerId: owner.id },
      select: { id: true, _count: { select: { examQuestions: true, attemptQuestions: true } } },
    });
    if (!question) throw errors.notFound("Question not found.");

    const inUse = question._count.examQuestions > 0 || question._count.attemptQuestions > 0;
    if (inUse) {
      await tx.question.update({ where: { id }, data: { isArchived: true } });
      return { outcome: "ARCHIVED" as const };
    }
    await tx.question.delete({ where: { id } });
    return { outcome: "DELETED" as const };
  });
}
