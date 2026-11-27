import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from "../../src/server/modules/import/schemas";
import {
  BASE_URL, Client, closeDatabase, createTempUser, removeTempUsers, resetRateLimits,
  scalar, signInAs, sql, type TempUser,
} from "./helpers";

const path = "/import/questions";
const jobs = "/import/jobs";
const header = "topicId,type,difficulty,text,explanation,defaultMarks,options";
let examiner: TempUser;
let other: TempUser;
let topicId: string;
let otherTopicId: string;

const written = (text: string) => ({ topicId, type: "WRITTEN", difficulty: "HARD", text, defaultMarks: 1 });
const csv = (body: string) => examiner.client.post(path + "?fileName=questions.csv", undefined, {
  rawBody: body, headers: { "Content-Type": "text/csv; charset=utf-8" },
});

async function createTopic(owner: TempUser): Promise<string> {
  const response = await owner.client.post("/topics", { name: "Import topic" });
  assert.equal(response.status, 201, response.text);
  return response.body.data.id;
}

async function ownerCounts() {
  const params = [examiner.id];
  const questions = Number(await scalar('SELECT count(*) FROM "Question" WHERE "ownerId" = $1', params));
  const imports = Number(await scalar('SELECT count(*) FROM "ImportJob" WHERE "userId" = $1', params));
  return { questions, imports };
}

before(async () => {
  await resetRateLimits();
  examiner = await createTempUser("EXAMINER");
  other = await createTempUser("EXAMINER");
  topicId = await createTopic(examiner);
  otherTopicId = await createTopic(other);
});
beforeEach(resetRateLimits);
after(async () => {
  await removeTempUsers();
  await resetRateLimits();
  await closeDatabase();
});

describe("question import access", () => {
  it("requires an examiner session for both endpoints", async () => {
    const clients: [Client, number][] = [
      [new Client(), 401],
      [await signInAs("candidate"), 403],
      [await signInAs("admin"), 403],
    ];
    for (const [client, status] of clients) {
      assert.equal((await client.post(path, [written("Role check")])).status, status);
      assert.equal((await client.get(jobs)).status, status);
    }
  });

  it("applies the origin check before recording any import", async () => {
    const before = await ownerCounts();
    const response = await examiner.client.post(path, [written("Origin check")], {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await ownerCounts(), before);
  });
});

describe("import outcomes", () => {
  it("imports valid JSON rows, reports invalid rows and stores the same job", async () => {
    const question = {
      ...written("JSON objective question"),
      type: "SINGLE_CHOICE",
      difficulty: "MEDIUM",
      defaultMarks: 1.25,
      options: [{ text: "First option", isCorrect: false }, { text: "Second option", isCorrect: true }],
    };
    const before = await ownerCounts();
    const response = await examiner.client.post(path + "?fileName=My%20questions.json", [
      question,
      { ...written("Missing difficulty"), difficulty: undefined },
      { ...question, text: "Two answers marked", options: question.options.map((option) => ({ ...option, isCorrect: true })) },
      { ...written("Foreign topic"), topicId: otherTopicId },
      { ...written("Unknown topic"), topicId: "missing-import-topic" },
      { ...question, text: "  " + question.text + "  " },
      { ...written("Unexpected ownership"), ownerId: other.id },
      written("Invalid \u0000 text"),
      { ...written("Over-precise marks"), defaultMarks: 1.001 },
      null,
      { ...question, text: "Too many options", options: Array(11).fill(null) },
      written("JSON written question"),
    ]);

    assert.equal(response.status, 201, response.text);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const job = response.body.data;
    assert.deepEqual(Object.keys(job).sort(), [
      "createdAt", "errors", "failureCount", "fileName", "id", "kind", "successCount", "totalRows",
    ]);
    assert.equal(job.kind, "QUESTIONS");
    assert.equal(job.fileName, "My questions.json");
    assert.equal(job.totalRows, 12);
    assert.equal(job.successCount, 2);
    assert.equal(job.failureCount, 10);
    assert.deepEqual(job.errors.map(({ row, field }: { row: number; field: string }) => [row, field]), [
      [2, "difficulty"], [3, "options"], [4, "topicId"], [5, "topicId"],
      [6, "row"], [7, "row"], [8, "text"], [9, "defaultMarks"], [10, "row"], [11, "options"],
    ]);
    assert.equal(job.errors[2].message, job.errors[3].message);
    assert.deepEqual(await ownerCounts(), { questions: before.questions + 2, imports: before.imports + 1 });

    const [storedJob] = await sql('SELECT "userId", errors FROM "ImportJob" WHERE id = $1', [job.id]);
    assert.deepEqual(storedJob, { userId: examiner.id, errors: job.errors });

    const [storedQuestion] = await sql(
      'SELECT id, difficulty, "topicId", "defaultMarks"::float8 FROM "Question" WHERE "ownerId" = $1 AND text = $2',
      [examiner.id, question.text],
    );
    assert.equal(storedQuestion.difficulty, "MEDIUM");
    assert.equal(storedQuestion.topicId, topicId);
    assert.equal(storedQuestion.defaultMarks, 1.25);
    const options = await sql(
      'SELECT text, "isCorrect", position FROM "QuestionOption" WHERE "questionId" = $1 ORDER BY position',
      [storedQuestion.id],
    );
    assert.deepEqual(options, question.options.map((option, index) => ({ ...option, position: index + 1 })));
  });

  it("accepts a UTF-8 BOM and quoted punctuation, retains formula prefixes, and reports a wrong column count", async () => {
    const formulaTexts = ["=A1", "+123", "-123", "@name"];
    const options = '[{"text":"A, or B","isCorrect":true},{"text":"C","isCorrect":false},{"text":"+D","isCorrect":true}]';
    const csvCell = (text: string) => '"' + text.replaceAll('"', '""') + '"';
    const prompt = 'Explain "this", with a comma.\r\nThen show the result.';
    const response = await csv([
      "\uFEFF" + header,
      topicId + ",MULTIPLE_SELECT,MEDIUM," + csvCell(prompt) + ",,2," + csvCell(options),
      topicId + ",WRITTEN,HARD,Too few columns",
      ...formulaTexts.map((text) => topicId + ",WRITTEN,EASY," + text + ",,0.25,"),
      topicId + ",WRITTEN,HARD,Malformed options,,2,not-json",
      "",
    ].join("\r\n"));

    assert.equal(response.status, 201, response.text);
    assert.equal(response.body.data.successCount, 5);
    assert.deepEqual(response.body.data.errors.map(({ row, field }: { row: number; field: string }) => [row, field]), [
      [3, "row"], [8, "options"],
    ]);
    const storedRows = await sql<{ text: string }>(
      'SELECT text FROM "Question" WHERE "ownerId" = $1 AND text = ANY($2)',
      [examiner.id, [prompt, ...formulaTexts]],
    );
    assert.deepEqual(new Set(storedRows.map(({ text }) => text)), new Set([prompt, ...formulaTexts]));
    const storedOptions = await sql(
      'SELECT o.text, o."isCorrect" FROM "QuestionOption" o JOIN "Question" q ON o."questionId" = q.id WHERE q.text = $1 AND q."ownerId" = $2 ORDER BY o.position',
      [prompt, examiner.id],
    );
    assert.deepEqual(storedOptions, JSON.parse(options));
  });

  it("records an all-rejected file and keeps concurrent valid imports intact", async () => {
    const before = await ownerCounts();
    const emptyResult = await examiner.client.post(path, [{ ...written("Bad topic"), topicId: null }]);
    assert.equal(emptyResult.status, 201, emptyResult.text);
    assert.equal(emptyResult.body.data.fileName, "questions.json");
    assert.equal(emptyResult.body.data.successCount, 0);
    assert.equal(emptyResult.body.data.failureCount, 1);

    const concurrent = await Promise.all(["first", "second"].map((prefix) =>
      examiner.client.post(path, [written(prefix + " concurrent A"), written(prefix + " concurrent B")]),
    ));
    for (const response of concurrent) {
      assert.equal(response.status, 201, response.text);
      assert.equal(response.body.data.successCount, 2);
    }
    assert.notEqual(concurrent[0].body.data.id, concurrent[1].body.data.id);
    assert.deepEqual(await ownerCounts(), { questions: before.questions + 4, imports: before.imports + 3 });
  });
});

describe("upload limits", () => {
  it("rejects malformed files and spoofed file names before writing a job", async () => {
    const before = await ownerCounts();
    const responses = [
      await examiner.client.post(path, { rows: [written("Wrapped JSON")] }),
      await examiner.client.post(path, []),
      await examiner.client.post(path + "?fileName=..%2Fquestions.json", [written("Invalid file name")]),
      await examiner.client.post(path, undefined, { rawBody: "[", headers: { "Content-Type": "application/json" } }),
      await examiner.client.post(path, undefined, { rawBody: "bad", headers: { "Content-Type": "text/plain" } }),
      await csv("wrong,header"),
      await csv(header + "\n" + topicId + ",WRITTEN,HARD,\"unclosed"),
      await csv(header),
    ];
    assert.deepEqual(responses.map(({ status }) => status), [400, 400, 422, 400, 400, 400, 400, 400]);

    const invalidBytes = await fetch(BASE_URL + "/api/v1" + path, {
      method: "POST",
      body: Uint8Array.of(0xc3, 0x28),
      headers: { "Content-Type": "text/csv", Cookie: "exam_session=" + examiner.client.cookie("exam_session") },
    });
    assert.equal(invalidBytes.status, 400);
    assert.match(await invalidBytes.text(), /UTF-8/);
    assert.deepEqual(await ownerCounts(), before);
  });

  it("accepts the byte and row limits, then rejects one over either limit", async () => {
    const before = await ownerCounts();
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => written("Row limit " + index));
    const json = JSON.stringify(rows);
    const body = json.padEnd(MAX_IMPORT_BYTES, " ");
    const valid = await examiner.client.post(path, undefined, { rawBody: body });
    assert.equal(valid.status, 201, valid.text);
    assert.equal(valid.body.data.successCount, MAX_IMPORT_ROWS);

    const tooMany = await examiner.client.post(path, [...rows, written("One too many")]);
    assert.equal(tooMany.status, 413, tooMany.text);
    const tooManyCsv = await csv(header + "\n" + (topicId + ",WRITTEN,EASY,Too many,,1,\n").repeat(MAX_IMPORT_ROWS + 1));
    assert.equal(tooManyCsv.status, 413, tooManyCsv.text);
    const tooLarge = await examiner.client.post(path, undefined, { rawBody: body + " " });
    assert.equal(tooLarge.status, 413, tooLarge.text);
    assert.deepEqual(await ownerCounts(), { questions: before.questions + MAX_IMPORT_ROWS, imports: before.imports + 1 });
  });

  it("rate limits upload attempts per examiner, including malformed files", async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await examiner.client.post(path, [])).status, 400);
    }
    const response = await examiner.client.post(path, [written("Limited")]);
    assert.equal(response.status, 429);
    assert.ok(Number(response.headers.get("retry-after")) > 0);
    const otherResponse = await other.client.post(path, [{ ...written("Other import"), topicId: otherTopicId }]);
    assert.equal(otherResponse.status, 201, otherResponse.text);
  });
});

describe("import history", () => {
  it("pages the examiner's own jobs in deterministic order, including tied timestamps", async () => {
    await sql(
      `INSERT INTO "ImportJob" (id, "userId", kind, "fileName", "totalRows", "successCount", "failureCount", "createdAt")
       VALUES ('e2e-import-tie-a', $1, 'QUESTIONS', 'tie-a.csv', 1, 1, 0, '2099-01-01'),
              ('e2e-import-tie-b', $1, 'QUESTIONS', 'tie-b.csv', 1, 1, 0, '2099-01-01'),
              ('e2e-import-hidden', $2, 'QUESTIONS', 'hidden.csv', 1, 1, 0, '2099-01-02')`,
      [examiner.id, other.id],
    );

    const withErrors = await examiner.client.post(path + "?fileName=history-errors.json", [
      { ...written("History error"), difficulty: undefined },
    ]);
    assert.equal(withErrors.status, 201, withErrors.text);

    const first = await examiner.client.get(jobs + "?pageSize=1");
    assert.equal(first.status, 200, first.text);
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(first.body.data[0].fileName, "tie-b.csv");
    assert.equal(first.body.meta.pageSize, 1);
    const next = await examiner.client.get(jobs + "?pageSize=1&cursor=" + first.body.meta.nextCursor);
    assert.equal(next.status, 200, next.text);
    assert.equal(next.body.data[0].fileName, "tie-a.csv");

    const own = await examiner.client.get(jobs);
    const all = own.body.data.map(({ fileName }: { fileName: string }) => fileName);
    assert.ok(all.includes("history-errors.json"));
    assert.ok(!all.includes("hidden.csv"));
    assert.equal(own.body.meta.nextCursor, null);
    const jsonJob = own.body.data.find(({ fileName }: { fileName: string }) => fileName === "history-errors.json");
    assert.equal(jsonJob.errors[0].field, "difficulty");

    const otherPage = await other.client.get(jobs + "?cursor=" + first.body.meta.nextCursor);
    assert.equal(otherPage.status, 200, otherPage.text);
    assert.ok(otherPage.body.data.every(({ fileName }: { fileName: string }) => !["tie-a.csv", "history-errors.json"].includes(fileName)));
  });

  it("rejects malformed cursors, unknown filters and out-of-range page sizes", async () => {
    for (const query of ["cursor=bad", "cursor=", "pageSize=0", "pageSize=51", "userId=other"]) {
      const response = await examiner.client.get(jobs + "?" + query);
      assert.equal(response.status, 422, response.text);
    }
  });
});
