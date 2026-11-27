import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calculateExamState, difficultyCounts, examRules } from "./rules";

describe("difficulty counts", () => {
  it("apportions fractional shares and uses difficulty order on a tie", () => {
    assert.deepEqual(difficultyCounts(7, { EASY: 33, MEDIUM: 33, HARD: 34 }), { EASY: 2, MEDIUM: 2, HARD: 3 });
    assert.deepEqual(difficultyCounts(1, { EASY: 50, MEDIUM: 50, HARD: 0 }), { EASY: 1, MEDIUM: 0, HARD: 0 });
    assert.deepEqual(difficultyCounts(13, { EASY: 0, MEDIUM: 25, HARD: 75 }), { EASY: 0, MEDIUM: 3, HARD: 10 });
  });

  it("preserves the total and never allocates questions to a zero share", () => {
    for (let count = 1; count <= 21; count++) {
      for (let easy = 0; easy <= 100; easy++) {
        for (let medium = 0; medium <= 100 - easy; medium++) {
          const hard = 100 - easy - medium;
          const result = difficultyCounts(count, { EASY: easy, MEDIUM: medium, HARD: hard });
          assert.equal(result.EASY + result.MEDIUM + result.HARD, count);
          if (easy === 0) assert.equal(result.EASY, 0);
          if (medium === 0) assert.equal(result.MEDIUM, 0);
          if (hard === 0) assert.equal(result.HARD, 0);
        }
      }
    }
  });
});

describe("exam state and candidate rules", () => {
  const startsAt = new Date("2026-11-28T12:00:00Z");
  const endsAt = new Date("2026-11-28T13:00:00Z");
  const exam = { startsAt, endsAt, status: "PUBLISHED" } as const;

  it("uses both slot boundaries and preserves explicit draft and completed statuses", () => {
    assert.equal(calculateExamState(exam, new Date(+startsAt - 1)), "PUBLISHED");
    assert.equal(calculateExamState(exam, startsAt), "ONGOING");
    assert.equal(calculateExamState(exam, endsAt), "ONGOING");
    assert.equal(calculateExamState(exam, new Date(+endsAt + 1)), "COMPLETED");
    assert.equal(calculateExamState({ ...exam, status: "DRAFT" }, endsAt), "DRAFT");
    assert.equal(calculateExamState({ ...exam, status: "COMPLETED" }, startsAt), "COMPLETED");
  });

  it("describes paper settings and every active integrity switch", () => {
    const settings = {
      startsAt, endsAt, durationMinutes: 30, maxAttempts: null, resultPolicy: "LATEST",
      selectionMode: "BALANCED", totalMarks: 12.5, multiSelectScoring: "PARTIAL",
      shuffleQuestions: true, shuffleOptions: true, desktopOnly: true, blockClipboard: true,
      blockContextMenu: true, requireFullscreen: true, detectExtraDisplay: true, watermark: true,
      aiNotice: true, honeypot: true,
    } as const;
    const rules = examRules(settings);
    assert.equal(rules.totalMarks, 12.5);
    assert.equal(rules.maxAttempts, null);
    for (const phrase of [
      "deadline", "latest attempt", "same total marks", "wrong choice", "Question order is shuffled",
      "Answer options are shuffled", "desktop browser", "Copy, cut and paste", "Right-click",
      "full screen", "extra display", "watermark", "AI assistants", "integrity marker",
    ]) {
      assert.ok(rules.statements.some((line) => line.includes(phrase)), phrase);
    }
    assert.ok(examRules({ ...settings, requireFullscreen: false }).statements.every((line) => !line.includes("full screen")));
  });
});
