import assert from "node:assert/strict";
import { it } from "node:test";
import { drawBalanced } from "./draw";
import { difficulties } from "./rules";

it("draws equal difficulty counts and marks while rotating across topics", () => {
  const pool = difficulties.flatMap((difficulty, level) => Array.from({ length: 9 }, (_, index) => ({
    id: `${difficulty}-${index}`, difficulty, topicId: `topic-${index % 3}`, marks: level + 1,
  })));
  const counts = { EASY: 2, MEDIUM: 3, HARD: 4 };
  const examples = new Set<string>();
  for (let run = 0; run < 40; run++) {
    const paper = drawBalanced(pool, counts);
    assert.ok(paper);
    assert.equal(paper.length, 9);
    assert.equal(new Set(paper.map(({ id }) => id)).size, 9);
    assert.equal(paper.reduce((sum, item) => sum + item.marks, 0), 20);
    for (const difficulty of difficulties) {
      const questions: typeof pool = paper.filter((question) => question.difficulty === difficulty);
      assert.equal(questions.length, counts[difficulty]);
      assert.equal(new Set(questions.map(({ topicId }) => topicId)).size, Math.min(3, counts[difficulty]));
    }
    examples.add(paper.map(({ id }) => id).join(","));
  }
  assert.ok(examples.size > 1);
  assert.equal(drawBalanced(pool, { ...counts, EASY: 10 }), null);
});
