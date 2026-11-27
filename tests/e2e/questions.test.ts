import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import {
  Client,
  closeDatabase,
  createTempUser,
  removeTempUsers,
  resetRateLimits,
  scalar,
  signInAs,
  sql,
  type TempUser,
} from "./helpers";

let examiner: TempUser;
let other: TempUser;
let topicId: string;

const count = async (text: string, params: unknown[] = []) => Number(await scalar<string>(text, params));

async function makeTopic(client: Client, name: string): Promise<string> {
  const response = await client.post("/topics", { name });
  assert.equal(response.status, 201, response.text);
  return response.body.data.id;
}

const singleChoice = (overrides: Record<string, unknown> = {}) => ({
  topicId,
  type: "SINGLE_CHOICE",
  difficulty: "MEDIUM",
  text: "What is 2 + 2?",
  defaultMarks: 2,
  options: [
    { text: "3", isCorrect: false },
    { text: "4", isCorrect: true },
    { text: "5", isCorrect: false },
  ],
  ...overrides,
});

const multipleSelect = (overrides: Record<string, unknown> = {}) => ({
  topicId,
  type: "MULTIPLE_SELECT",
  difficulty: "HARD",
  text: "Which numbers are prime?",
  defaultMarks: 3,
  options: [
    { text: "2", isCorrect: true },
    { text: "3", isCorrect: true },
    { text: "4", isCorrect: false },
  ],
  ...overrides,
});

const written = (overrides: Record<string, unknown> = {}) => ({
  topicId,
  type: "WRITTEN",
  difficulty: "EASY",
  text: "Explain why the sky is blue.",
  defaultMarks: 5,
  ...overrides,
});

const without = (body: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(body).filter(([name]) => name !== key));

async function create(body: Record<string, unknown>, client: Client = examiner.client) {
  const response = await client.post("/questions", body);
  assert.equal(response.status, 201, response.text);
  return response.body.data;
}

// Puts a question into an exam's pool directly, to exercise "in use" rules
// before the exams module exists.
async function useInExam(questionId: string, ownerId: string): Promise<void> {
  const examId = `e2e-exam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await sql(
    `INSERT INTO "Exam" (id, "ownerId", title, "startsAt", "endsAt", "durationMinutes", "totalMarks", "updatedAt")
     VALUES ($1, $2, 'Fixture exam', now() + interval '1 day', now() + interval '2 days', 60, 10, now())`,
    [examId, ownerId],
  );
  await sql(
    `INSERT INTO "ExamQuestion" (id, "examId", "questionId", marks, position) VALUES ($1, $2, $3, 2, 1)`,
    [`${examId}-q`, examId, questionId],
  );
}

before(async () => {
  await resetRateLimits();
  examiner = await createTempUser("EXAMINER");
  other = await createTempUser("EXAMINER");
  topicId = await makeTopic(examiner.client, "Arithmetic");
});
beforeEach(resetRateLimits);
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

describe("access control", () => {
  const calls = (): [string, string, unknown?][] => [
    ["GET", "/topics"],
    ["POST", "/topics", { name: "X" }],
    ["PATCH", `/topics/${topicId}`, { name: "X" }],
    ["DELETE", `/topics/${topicId}`],
    ["GET", "/questions"],
    ["POST", "/questions", singleChoice()],
    ["GET", "/questions/some-id"],
    ["PATCH", "/questions/some-id", { text: "X" }],
    ["DELETE", "/questions/some-id"],
  ];

  it("refuses every call without a session", async () => {
    for (const [method, path, json] of calls()) {
      assert.equal((await new Client().request(method, path, { json })).status, 401, `${method} ${path}`);
    }
  });

  it("refuses candidates, who must never see an answer key", async () => {
    const candidate = await createTempUser("CANDIDATE");
    const question = await create(singleChoice());
    for (const [method, path, json] of [...calls(), ["GET", `/questions/${question.id}`] as [string, string]]) {
      const response = await candidate.client.request(method, path, { json });
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.doesNotMatch(response.text, /isCorrect/);
    }
  });

  it("refuses administrators: the question bank is examination content", async () => {
    const admin = await signInAs("admin");
    for (const [method, path, json] of calls()) {
      assert.equal((await admin.request(method, path, { json })).status, 403, `${method} ${path}`);
    }
  });
});

describe("isolation between examiners", () => {
  it("shows an examiner only their own topics and questions", async () => {
    const question = await create(singleChoice({ text: "Private to the first examiner" }));
    const topics = await other.client.get("/topics");
    const questions = await other.client.get("/questions?pageSize=100");
    assert.deepEqual(topics.body.data, []);
    assert.ok(!questions.body.data.some((item: { id: string }) => item.id === question.id));
    assert.doesNotMatch(questions.text, /Private to the first examiner/);
  });

  it("reports another examiner's question or topic as not found, never forbidden", async () => {
    const question = await create(singleChoice());
    for (const [method, path, json] of [
      ["GET", `/questions/${question.id}`],
      ["PATCH", `/questions/${question.id}`, { text: "Hijacked" }],
      ["DELETE", `/questions/${question.id}`],
      ["PATCH", `/topics/${topicId}`, { name: "Hijacked" }],
      ["DELETE", `/topics/${topicId}`],
    ] as [string, string, unknown?][]) {
      const response = await other.client.request(method, path, { json });
      assert.equal(response.status, 404, `${method} ${path}`);
    }
    assert.equal((await examiner.client.get(`/questions/${question.id}`)).body.data.text, "What is 2 + 2?");
  });

  it("does not let an examiner file a question under another examiner's topic", async () => {
    const response = await other.client.post("/questions", singleChoice());
    assert.equal(response.status, 422);
    assert.equal(response.body.error.details[0].path, "topicId");

    const own = await create(singleChoice());
    const foreignTopic = await makeTopic(other.client, "Other bank");
    const moved = await examiner.client.patch(`/questions/${own.id}`, { topicId: foreignTopic });
    assert.equal(moved.status, 422);
  });

  it("lets two examiners use the same topic name", async () => {
    assert.equal((await other.client.post("/topics", { name: "Arithmetic" })).status, 201);
  });
});

describe("topics", () => {
  it("creates a topic with a trimmed name and lists it with question counts", async () => {
    const id = await makeTopic(examiner.client, "  Geometry  ");
    await create(singleChoice({ topicId: id, difficulty: "EASY" }));
    await create(singleChoice({ topicId: id, difficulty: "EASY", text: "Another easy one" }));
    await create(written({ topicId: id, difficulty: "HARD" }));
    const archived = await create(written({ topicId: id, difficulty: "HARD", text: "Archived one" }));
    await examiner.client.patch(`/questions/${archived.id}`, { isArchived: true });

    const topic = (await examiner.client.get("/topics")).body.data.find((item: { id: string }) => item.id === id);
    assert.equal(topic.name, "Geometry");
    assert.deepEqual(topic.byDifficulty, { EASY: 2, MEDIUM: 0, HARD: 1 }, "archived questions are not counted");
    assert.equal(topic.questionCount, 3);
    assert.deepEqual(Object.keys(topic).sort(), ["byDifficulty", "createdAt", "id", "name", "questionCount"]);
  });

  it("lists topics in name order", async () => {
    await makeTopic(examiner.client, "Zoology");
    await makeTopic(examiner.client, "Algebra");
    const names = (await examiner.client.get("/topics")).body.data.map((item: { name: string }) => item.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });

  it("refuses a duplicate name, ignoring letter case and spaces", async () => {
    await makeTopic(examiner.client, "History");
    for (const name of ["History", "HISTORY", "  history "]) {
      const response = await examiner.client.post("/topics", { name });
      assert.equal(response.status, 409, name);
    }
  });

  it("creates one topic when the same request races itself", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => examiner.client.post("/topics", { name: "Raced topic" })),
    );
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.ok(responses.every((response) => [201, 409].includes(response.status)));
  });

  it("renames a topic, allows a change of letter case, and refuses a clash", async () => {
    const id = await makeTopic(examiner.client, "Physics");
    await makeTopic(examiner.client, "Chemistry");
    assert.equal((await examiner.client.patch(`/topics/${id}`, { name: "PHYSICS" })).body.data.name, "PHYSICS");
    assert.equal((await examiner.client.patch(`/topics/${id}`, { name: "chemistry" })).status, 409);
  });

  it("deletes an empty topic but not one that holds questions, archived or not", async () => {
    const empty = await makeTopic(examiner.client, "Empty topic");
    assert.equal((await examiner.client.delete(`/topics/${empty}`)).status, 204);
    assert.equal((await examiner.client.delete(`/topics/${empty}`)).status, 404);

    const full = await makeTopic(examiner.client, "Full topic");
    const question = await create(written({ topicId: full }));
    await examiner.client.patch(`/questions/${question.id}`, { isArchived: true });
    assert.equal((await examiner.client.delete(`/topics/${full}`)).status, 409);
  });

  it("validates the name", async () => {
    for (const body of [{}, { name: "" }, { name: "   " }, { name: "n".repeat(81) }, { name: 42 }, { name: "Ok", ownerId: other.id }]) {
      assert.equal((await examiner.client.post("/topics", body)).status, 422, JSON.stringify(body));
    }
  });
});

describe("creating questions", () => {
  it("creates a single-choice question with its options in the given order", async () => {
    const question = await create(singleChoice());
    assert.deepEqual(Object.keys(question).sort(), [
      "createdAt",
      "defaultMarks",
      "difficulty",
      "explanation",
      "id",
      "isArchived",
      "options",
      "text",
      "topic",
      "type",
      "updatedAt",
      "usedInExams",
    ]);
    assert.equal(question.defaultMarks, 2);
    assert.equal(typeof question.defaultMarks, "number");
    assert.deepEqual(question.topic, { id: topicId, name: "Arithmetic" });
    assert.deepEqual(
      question.options.map((option: { text: string; isCorrect: boolean; position: number }) => [option.position, option.text, option.isCorrect]),
      [[1, "3", false], [2, "4", true], [3, "5", false]],
    );
    assert.equal(question.isArchived, false);
    assert.equal(question.usedInExams, 0);
    assert.equal(question.explanation, null);
  });

  it("creates a multiple-select question with one or several correct options", async () => {
    assert.equal((await create(multipleSelect())).options.filter((option: { isCorrect: boolean }) => option.isCorrect).length, 2);
    const oneCorrect = await create(
      multipleSelect({ options: [{ text: "Yes", isCorrect: true }, { text: "No", isCorrect: false }] }),
    );
    assert.equal(oneCorrect.type, "MULTIPLE_SELECT");
  });

  it("creates a written-response question with no options", async () => {
    const question = await create(written({ explanation: "  Rayleigh scattering.  " }));
    assert.deepEqual(question.options, []);
    assert.equal(question.explanation, "Rayleigh scattering.");
    assert.equal((await create(written({ options: [] }))).options.length, 0);
  });

  it("accepts fractional marks to two decimal places", async () => {
    for (const marks of [0.25, 0.5, 1.75, 1000, 12.34]) {
      assert.equal((await create(written({ defaultMarks: marks }))).defaultMarks, marks);
    }
  });

  it("enforces the answer-key rules for each type", async () => {
    const two = (first: boolean, second: boolean) => [
      { text: "A", isCorrect: first },
      { text: "B", isCorrect: second },
    ];
    const cases: [string, Record<string, unknown>][] = [
      ["single choice with no correct option", singleChoice({ options: two(false, false) })],
      ["single choice with two correct options", singleChoice({ options: two(true, true) })],
      ["single choice with one option", singleChoice({ options: [{ text: "A", isCorrect: true }] })],
      ["single choice with no options", singleChoice({ options: [] })],
      ["single choice with options missing", without(singleChoice(), "options")],
      ["multiple select with no correct option", multipleSelect({ options: two(false, false) })],
      ["eleven options", singleChoice({ options: Array.from({ length: 11 }, (_, index) => ({ text: `Option ${index}`, isCorrect: index === 0 })) })],
      ["duplicate options", singleChoice({ options: [{ text: "Same", isCorrect: true }, { text: " same ", isCorrect: false }] })],
      ["written response with options", written({ options: two(true, false) })],
    ];
    for (const [label, body] of cases) {
      const response = await examiner.client.post("/questions", body);
      assert.equal(response.status, 422, label);
      assert.equal(response.body.error.details[0].path, "options", label);
    }
  });

  it("accepts exactly ten options", async () => {
    const options = Array.from({ length: 10 }, (_, index) => ({ text: `Option ${index}`, isCorrect: index === 3 }));
    assert.equal((await create(singleChoice({ options }))).options.length, 10);
  });

  it("validates every field", async () => {
    const cases: [string, Record<string, unknown>, string][] = [
      ["blank text", singleChoice({ text: "   " }), "text"],
      ["text over 5000 characters", singleChoice({ text: "t".repeat(5001) }), "text"],
      ["missing difficulty", without(singleChoice(), "difficulty"), "difficulty"],
      ["unknown difficulty", singleChoice({ difficulty: "IMPOSSIBLE" }), "difficulty"],
      ["lower-case difficulty", singleChoice({ difficulty: "easy" }), "difficulty"],
      ["unknown type", singleChoice({ type: "TRUE_FALSE" }), "type"],
      ["zero marks", singleChoice({ defaultMarks: 0 }), "defaultMarks"],
      ["negative marks", singleChoice({ defaultMarks: -1 }), "defaultMarks"],
      ["marks over 1000", singleChoice({ defaultMarks: 1000.01 }), "defaultMarks"],
      ["three decimal places", singleChoice({ defaultMarks: 1.005 }), "defaultMarks"],
      ["marks as text", singleChoice({ defaultMarks: "2" }), "defaultMarks"],
      ["unknown topic", singleChoice({ topicId: "no-such-topic" }), "topicId"],
      ["blank option text", singleChoice({ options: [{ text: " ", isCorrect: true }, { text: "B", isCorrect: false }] }), "options.0.text"],
      ["option without a correct flag", singleChoice({ options: [{ text: "A" }, { text: "B", isCorrect: true }] }), "options.0.isCorrect"],
      ["explanation over 5000 characters", written({ explanation: "e".repeat(5001) }), "explanation"],
    ];
    for (const [label, body, path] of cases) {
      const response = await examiner.client.post("/questions", body);
      assert.equal(response.status, 422, label);
      assert.ok(
        response.body.error.details.some((detail: { path: string }) => detail.path === path),
        `${label}: expected ${path}, got ${JSON.stringify(response.body.error.details)}`,
      );
    }
  });

  it("rejects fields it does not know, including ownership and state", async () => {
    for (const extra of [{ ownerId: other.id }, { isArchived: true }, { id: "chosen" }, { usedInExams: 5 }]) {
      assert.equal((await examiner.client.post("/questions", singleChoice(extra))).status, 422, JSON.stringify(extra));
    }
    const optionExtra = singleChoice({ options: [{ text: "A", isCorrect: true, id: "x" }, { text: "B", isCorrect: false }] });
    assert.equal((await examiner.client.post("/questions", optionExtra)).status, 422);
  });

  it("stores unusual text unchanged and refuses a NUL character", async () => {
    const text = `<script>alert("x")</script> O'Neil & "quotes" 数学 🎓 %_\\`;
    const question = await create(singleChoice({ text, options: [{ text: "<b>bold</b>", isCorrect: true }, { text: "'; DROP TABLE x; --", isCorrect: false }] }));
    assert.equal(question.text, text);
    assert.equal(question.options[0].text, "<b>bold</b>");
    assert.equal((await examiner.client.post("/questions", singleChoice({ text: "nul\u0000here" }))).status, 400);
  });

  it("refuses a body over the size limit", async () => {
    const response = await examiner.client.post("/questions", written({ explanation: "x".repeat(70_000) }));
    assert.equal(response.status, 413);
  });
});

describe("listing questions", () => {
  let lister: TempUser;
  let algebra: string;
  let biology: string;

  before(async () => {
    lister = await createTempUser("EXAMINER");
    algebra = await makeTopic(lister.client, "Algebra");
    biology = await makeTopic(lister.client, "Biology");
    const add = (body: Record<string, unknown>) => create(body, lister.client);
    await add(singleChoice({ topicId: algebra, difficulty: "EASY", text: "Solve x + 1 = 2" }));
    await add(multipleSelect({ topicId: algebra, difficulty: "HARD", text: "Pick the quadratics" }));
    await add(written({ topicId: biology, difficulty: "MEDIUM", text: "Describe mitosis at 100% detail" }));
    await add(written({ topicId: biology, difficulty: "EASY", text: "Name a cell_part" }));
    const hidden = await add(written({ topicId: biology, difficulty: "HARD", text: "Archived question" }));
    await lister.client.patch(`/questions/${hidden.id}`, { isArchived: true });
  });

  const texts = (response: { body: { data: { text: string }[] } }) => response.body.data.map((item) => item.text);

  it("returns active questions newest first, with paging totals", async () => {
    const response = await lister.client.get("/questions");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.meta, { page: 1, pageSize: 20, total: 4 });
    assert.deepEqual(texts(response), [
      "Name a cell_part",
      "Describe mitosis at 100% detail",
      "Pick the quadratics",
      "Solve x + 1 = 2",
    ]);
  });

  it("shows archived questions only when asked", async () => {
    assert.deepEqual(texts(await lister.client.get("/questions?isArchived=true")), ["Archived question"]);
  });

  it("filters by topic, type and difficulty, alone and together", async () => {
    assert.equal((await lister.client.get(`/questions?topicId=${algebra}`)).body.meta.total, 2);
    assert.equal((await lister.client.get("/questions?type=WRITTEN")).body.meta.total, 2);
    assert.equal((await lister.client.get("/questions?difficulty=EASY")).body.meta.total, 2);
    assert.deepEqual(texts(await lister.client.get(`/questions?topicId=${biology}&difficulty=EASY&type=WRITTEN`)), ["Name a cell_part"]);
    assert.equal((await lister.client.get(`/questions?topicId=${topicId}`)).body.meta.total, 0, "another examiner's topic matches nothing");
  });

  it("searches the question text literally, ignoring case", async () => {
    assert.deepEqual(texts(await lister.client.get("/questions?q=MITOSIS")), ["Describe mitosis at 100% detail"]);
    assert.deepEqual(texts(await lister.client.get("/questions?q=100%25")), ["Describe mitosis at 100% detail"]);
    assert.deepEqual(texts(await lister.client.get("/questions?q=cell_part")), ["Name a cell_part"]);
    assert.equal((await lister.client.get("/questions?q=%25")).body.meta.total, 1, "a percent sign is not a wildcard");
    assert.equal((await lister.client.get("/questions?q=cell%20part")).body.meta.total, 0, "an underscore is not a wildcard");
  });

  it("pages without overlap and returns an empty page past the end", async () => {
    const first = await lister.client.get("/questions?pageSize=3&page=1");
    const second = await lister.client.get("/questions?pageSize=3&page=2");
    assert.equal(first.body.data.length, 3);
    assert.equal(second.body.data.length, 1);
    const ids = [...first.body.data, ...second.body.data].map((item: { id: string }) => item.id);
    assert.equal(new Set(ids).size, 4);
    assert.deepEqual((await lister.client.get("/questions?page=99")).body.data, []);
  });

  it("rejects invalid filters and paging", async () => {
    for (const query of ["type=ESSAY", "difficulty=easy", "isArchived=yes", "page=0", "pageSize=101", "pageSize=x"]) {
      assert.equal((await lister.client.get(`/questions?${query}`)).status, 422, query);
    }
    assert.equal((await lister.client.get("/questions?q=a%00b")).status, 400);
  });
});

describe("updating questions", () => {
  it("changes text, difficulty, marks, explanation and topic", async () => {
    const question = await create(singleChoice());
    const newTopic = await makeTopic(examiner.client, `Moved ${Date.now()}`);
    const response = await examiner.client.patch(`/questions/${question.id}`, {
      text: "What is 3 + 3?",
      difficulty: "EASY",
      defaultMarks: 1.5,
      explanation: "It is six.",
      topicId: newTopic,
    });
    assert.equal(response.status, 200);
    const updated = response.body.data;
    assert.equal(updated.text, "What is 3 + 3?");
    assert.equal(updated.difficulty, "EASY");
    assert.equal(updated.defaultMarks, 1.5);
    assert.equal(updated.explanation, "It is six.");
    assert.equal(updated.topic.id, newTopic);
    assert.equal(updated.options.length, 3, "options are untouched when not sent");
    assert.equal(updated.type, "SINGLE_CHOICE");
  });

  it("clears the explanation with null or an empty string", async () => {
    const question = await create(written({ explanation: "Model answer" }));
    assert.equal((await examiner.client.patch(`/questions/${question.id}`, { explanation: null })).body.data.explanation, null);
    await examiner.client.patch(`/questions/${question.id}`, { explanation: "Back" });
    assert.equal((await examiner.client.patch(`/questions/${question.id}`, { explanation: "" })).body.data.explanation, null);
  });

  it("replaces the whole option set, keeping positions contiguous", async () => {
    const question = await create(singleChoice());
    const response = await examiner.client.patch(`/questions/${question.id}`, {
      options: [{ text: "Six", isCorrect: true }, { text: "Seven", isCorrect: false }],
    });
    assert.equal(response.status, 200);
    assert.deepEqual(
      response.body.data.options.map((option: { position: number; text: string }) => [option.position, option.text]),
      [[1, "Six"], [2, "Seven"]],
    );
    assert.equal(await count('SELECT count(*) FROM "QuestionOption" WHERE "questionId" = $1', [question.id]), 2);
  });

  it("applies the stored type's answer-key rules to new options", async () => {
    const single = await create(singleChoice());
    const twoCorrect = [{ text: "A", isCorrect: true }, { text: "B", isCorrect: true }];
    assert.equal((await examiner.client.patch(`/questions/${single.id}`, { options: twoCorrect })).status, 422);
    assert.equal((await examiner.client.patch(`/questions/${single.id}`, { options: [] })).status, 422);
    assert.equal((await examiner.client.get(`/questions/${single.id}`)).body.data.options.length, 3, "the old options survive a refused change");

    const multi = await create(multipleSelect());
    assert.equal((await examiner.client.patch(`/questions/${multi.id}`, { options: twoCorrect })).status, 200);

    const essay = await create(written());
    assert.equal((await examiner.client.patch(`/questions/${essay.id}`, { options: twoCorrect })).status, 422);
  });

  it("does not allow the type to change", async () => {
    const question = await create(singleChoice());
    assert.equal((await examiner.client.patch(`/questions/${question.id}`, { type: "WRITTEN" })).status, 422);
    assert.equal((await examiner.client.get(`/questions/${question.id}`)).body.data.type, "SINGLE_CHOICE");
  });

  it("archives and restores a question", async () => {
    const question = await create(written());
    assert.equal((await examiner.client.patch(`/questions/${question.id}`, { isArchived: true })).body.data.isArchived, true);
    assert.equal((await examiner.client.get(`/questions/${question.id}`)).status, 200, "an archived question can still be read");
    assert.equal((await examiner.client.patch(`/questions/${question.id}`, { isArchived: false })).body.data.isArchived, false);
  });

  it("rejects an empty change, unknown fields and invalid values", async () => {
    const question = await create(singleChoice());
    for (const change of [{}, { ownerId: other.id }, { id: "x" }, { difficulty: "NOPE" }, { defaultMarks: 0 }, { text: "" }, { isArchived: "yes" }]) {
      assert.equal((await examiner.client.patch(`/questions/${question.id}`, change)).status, 422, JSON.stringify(change));
    }
    assert.equal((await examiner.client.patch("/questions/missing", { text: "X" })).status, 404);
  });
});

describe("removing questions", () => {
  it("deletes a question that was never used, with its options", async () => {
    const question = await create(singleChoice());
    const response = await examiner.client.delete(`/questions/${question.id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.data, { outcome: "DELETED" });
    assert.equal((await examiner.client.get(`/questions/${question.id}`)).status, 404);
    assert.equal(await count('SELECT count(*) FROM "QuestionOption" WHERE "questionId" = $1', [question.id]), 0);
    assert.equal((await examiner.client.delete(`/questions/${question.id}`)).status, 404, "repeating it finds nothing");
  });

  it("archives a question that an exam uses, keeping it readable", async () => {
    const question = await create(singleChoice());
    await useInExam(question.id, examiner.id);
    assert.equal((await examiner.client.get(`/questions/${question.id}`)).body.data.usedInExams, 1);

    const response = await examiner.client.delete(`/questions/${question.id}`);
    assert.deepEqual(response.body.data, { outcome: "ARCHIVED" });

    const kept = await examiner.client.get(`/questions/${question.id}`);
    assert.equal(kept.status, 200);
    assert.equal(kept.body.data.isArchived, true);
    assert.equal(kept.body.data.options.length, 3);
    const listed = await examiner.client.get("/questions?pageSize=100");
    assert.ok(!listed.body.data.some((item: { id: string }) => item.id === question.id), "hidden from the default list");
  });

  it("returns 404 for ids that do not exist, whatever their shape", async () => {
    for (const id of ["missing", "a".repeat(300), "%00", encodeURIComponent("' OR 1=1 --")]) {
      assert.equal((await examiner.client.delete(`/questions/${id}`)).status, 404, id);
      assert.equal((await examiner.client.get(`/questions/${id}`)).status, 404, id);
    }
  });
});
