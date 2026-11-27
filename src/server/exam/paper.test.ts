import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectiveScore, scoreObjective, toCandidateQuestion, type PaperSnapshot } from "./paper";

const base = { version: 1, difficulty: "MEDIUM", topic: { id: "t", name: "Topic" }, text: "Q" } as const;

const single: PaperSnapshot = {
  ...base,
  type: "SINGLE_CHOICE",
  multiSelectScoring: "ALL_OR_NOTHING",
  options: [
    { id: "a", text: "A", isCorrect: false },
    { id: "b", text: "B", isCorrect: true },
    { id: "c", text: "C", isCorrect: false },
  ],
};

const multi = (scoring: "ALL_OR_NOTHING" | "PARTIAL"): PaperSnapshot => ({
  ...base,
  type: "MULTIPLE_SELECT",
  multiSelectScoring: scoring,
  options: [
    { id: "a", text: "A", isCorrect: true },
    { id: "b", text: "B", isCorrect: true },
    { id: "c", text: "C", isCorrect: true },
    { id: "d", text: "D", isCorrect: false },
    { id: "e", text: "E", isCorrect: false },
  ],
});

const written: PaperSnapshot = { ...base, type: "WRITTEN", multiSelectScoring: "ALL_OR_NOTHING", options: [] };

describe("candidate view of a question", () => {
  it("never contains the answer key", () => {
    const view = toCandidateQuestion(single, ["c", "a", "b"]);
    assert.doesNotMatch(JSON.stringify(view), /isCorrect/);
    assert.deepEqual(Object.keys(view).sort(), ["options", "text", "type"]);
  });

  it("puts the options in the order chosen for the candidate", () => {
    assert.deepEqual(toCandidateQuestion(single, ["c", "a", "b"]).options.map((option) => option.id), ["c", "a", "b"]);
  });

  it("ignores ids that are not options of the question", () => {
    assert.deepEqual(toCandidateQuestion(single, ["b", "zzz", "a"]).options.map((option) => option.id), ["b", "a"]);
  });

  it("has no options for a written response", () => {
    assert.deepEqual(toCandidateQuestion(written, []).options, []);
  });
});

describe("single-choice scoring", () => {
  it("gives full marks for the correct option only", () => {
    assert.equal(scoreObjective(single, ["b"], 4), 4);
    assert.equal(scoreObjective(single, ["a"], 4), 0);
    assert.equal(scoreObjective(single, [], 4), 0);
  });

  it("gives nothing when more than one option is sent", () => {
    assert.equal(scoreObjective(single, ["a", "b"], 4), 0);
    assert.equal(scoreObjective(single, ["a", "b", "c"], 4), 0);
  });
});

describe("multiple-select scoring, all or nothing", () => {
  const snapshot = multi("ALL_OR_NOTHING");

  it("gives full marks only for exactly the correct set, in any order", () => {
    assert.equal(scoreObjective(snapshot, ["c", "a", "b"], 6), 6);
    assert.equal(scoreObjective(snapshot, ["a", "b"], 6), 0);
    assert.equal(scoreObjective(snapshot, ["a", "b", "c", "d"], 6), 0);
    assert.equal(scoreObjective(snapshot, [], 6), 0);
  });
});

describe("multiple-select scoring, partial credit", () => {
  const snapshot = multi("PARTIAL");

  it("gives an equal share for each correct pick", () => {
    assert.equal(scoreObjective(snapshot, ["a"], 6), 2);
    assert.equal(scoreObjective(snapshot, ["a", "b"], 6), 4);
    assert.equal(scoreObjective(snapshot, ["a", "b", "c"], 6), 6);
  });

  it("cancels one share for each wrong pick and never goes below zero", () => {
    assert.equal(scoreObjective(snapshot, ["a", "b", "d"], 6), 2);
    assert.equal(scoreObjective(snapshot, ["a", "d", "e"], 6), 0);
    assert.equal(scoreObjective(snapshot, ["d"], 6), 0);
  });

  it("does not reward selecting every option", () => {
    assert.equal(scoreObjective(snapshot, ["a", "b", "c", "d", "e"], 6), 2);
  });

  it("rounds to two decimal places", () => {
    assert.equal(scoreObjective(snapshot, ["a"], 1), 0.33);
    assert.equal(scoreObjective(snapshot, ["a", "b"], 1), 0.67);
    assert.equal(scoreObjective(snapshot, ["a"], 0.25), 0.08);
  });
});

describe("crafted answers", () => {
  it("counts a repeated option once", () => {
    assert.equal(scoreObjective(multi("PARTIAL"), ["a", "a", "a"], 6), 2);
    assert.equal(scoreObjective(single, ["b", "b"], 4), 4);
  });

  it("ignores option ids from outside the question", () => {
    assert.equal(scoreObjective(single, ["b", "not-an-option"], 4), 4);
    assert.equal(scoreObjective(single, ["not-an-option"], 4), 0);
    assert.equal(scoreObjective(multi("PARTIAL"), ["a", "x", "y", "z"], 6), 2);
  });

  it("never returns more than the marks available or less than zero", () => {
    const snapshot = multi("PARTIAL");
    const ids = ["a", "b", "c", "d", "e"];
    for (let mask = 0; mask < 32; mask++) {
      const selected = ids.filter((_, index) => mask & (1 << index));
      const score = scoreObjective(snapshot, selected, 6)!;
      assert.ok(score >= 0 && score <= 6, `${selected.join("")} scored ${score}`);
    }
  });
});

describe("written responses and dispute outcomes", () => {
  it("leaves a written response for the examiner", () => {
    assert.equal(scoreObjective(written, [], 5), null);
  });

  it("accepts an additional answer added by a dispute", () => {
    const fixed: PaperSnapshot = { ...single, alsoAccepted: [["c"]] };
    assert.equal(scoreObjective(fixed, ["c"], 4), 4);
    assert.equal(scoreObjective(fixed, ["b"], 4), 4, "the original answer still earns full marks");
    assert.equal(scoreObjective(fixed, ["a"], 4), 0);
  });

  it("gives everyone full marks for a voided question, even with no answer", () => {
    const voided: PaperSnapshot = { ...single, voided: true };
    assert.equal(scoreObjective(voided, [], 4), 4);
    assert.equal(scoreObjective(voided, ["a"], 4), 4);
  });
});

describe("effective score", () => {
  it("prefers the examiner's mark, including a mark of zero", () => {
    assert.equal(effectiveScore(4, 2), 2);
    assert.equal(effectiveScore(4, 0), 0);
    assert.equal(effectiveScore(4, null), 4);
    assert.equal(effectiveScore(null, 3), 3);
    assert.equal(effectiveScore(null, null), null);
  });
});
