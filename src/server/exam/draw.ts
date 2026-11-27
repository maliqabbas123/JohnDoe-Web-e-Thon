import { randomInt } from "node:crypto";
import type { Difficulty } from "./paper";
import { difficulties } from "./rules";

export function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index--) {
    const other = randomInt(index + 1);
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

type BankQuestion = { difficulty: Difficulty; topicId: string };

export function drawBalanced<T extends BankQuestion>(
  pool: readonly T[], counts: Record<Difficulty, number>,
): T[] | null {
  const paper: T[] = [];
  for (const difficulty of difficulties) {
    const sameDifficulty = pool.filter((question) => question.difficulty === difficulty);
    const count = counts[difficulty];
    if (sameDifficulty.length < count) return null;

    const byTopic = new Map<string, T[]>();
    for (const question of shuffle(sameDifficulty)) {
      const topic = byTopic.get(question.topicId) ?? [];
      topic.push(question);
      byTopic.set(question.topicId, topic);
    }
    const topics = [...byTopic.values()];
    let remaining = count;
    for (let round = 0; remaining > 0; round++) {
      for (const topic of topics) {
        const question = topic[round];
        if (question) {
          paper.push(question);
          if (--remaining === 0) break;
        }
      }
    }
  }
  return paper;
}
