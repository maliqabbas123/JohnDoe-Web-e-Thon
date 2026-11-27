import { scoreObjective, type PaperSnapshot } from "@/server/exam/paper";

export const computedTypes = ["FAST_CORRECT_ANSWER", "PASTE_BYPASS", "SIMILAR_ANSWER", "HONEYPOT_TRIGGERED"] as const;

type Signal = {
  type: typeof computedTypes[number];
  severity: "MEDIUM" | "HIGH";
  attemptQuestionId?: string;
  details: Record<string, string | number>;
};

export type ComparableAnswer = {
  questionId: string;
  snapshot: PaperSnapshot;
  selectedOptionIds: string[];
  writtenAnswer: string | null;
};
export type IntegrityAnswer = ComparableAnswer & {
  id: string;
  timeSpentSeconds: number;
  firstOpenedAt: Date | null;
  savedAt: Date | null;
  keystrokeCount: number;
  pasteCount: number;
};
export type PeerAnswer = ComparableAnswer & { peerId: string };

function fingerprint(text: string | null): Set<string> | undefined {
  const sample = text?.trim().slice(0, 2000);
  if (!sample || sample.length < 80) return;
  const words = sample.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 12) return;
  return new Set(words.slice(1).map((word, index) => words[index] + " " + word));
}

function similarity(left: Set<string>, right: Set<string>): number {
  let shared = 0;
  for (const pair of left) if (right.has(pair)) shared++;
  return 2 * shared / (left.size + right.size);
}

function objectiveScore({ snapshot, selectedOptionIds }: ComparableAnswer): number | null {
  if (snapshot.type === "WRITTEN" || snapshot.voided || !selectedOptionIds.length) return null;
  if (!selectedOptionIds.every((id) => snapshot.options.some((option) => option.id === id))) return null;
  return scoreObjective(snapshot, selectedOptionIds, 100);
}

function wrongChoices(answer: ComparableAnswer): string | undefined {
  const score = objectiveScore(answer);
  if (score === null || score >= 100) return;
  return [...new Set(answer.selectedOptionIds)].sort().join(",");
}

function comparablePrompt(left: PaperSnapshot, right: PaperSnapshot): boolean {
  if (left.type !== right.type || left.text !== right.text || left.voided || right.voided) return false;
  if (left.type === "WRITTEN") return true;
  const choices = (options: PaperSnapshot["options"]) =>
    JSON.stringify(options.map(({ id, text, isCorrect }) => [id, text, isCorrect]).sort());
  return choices(left.options) === choices(right.options);
}

export function analyzeIntegrity(
  answers: IntegrityAnswer[],
  peers: PeerAnswer[],
  { marker, clipboardBlocked }: { marker: string | null; clipboardBlocked: boolean },
): Signal[] {
  const signals: Signal[] = [];
  const own = new Map(answers.map((answer) => [answer.questionId, {
    answer, words: fingerprint(answer.writtenAnswer), wrong: wrongChoices(answer),
  }]));
  const normalizedMarker = marker?.toLowerCase();
  for (const answer of answers) {
    const { id: attemptQuestionId, snapshot, writtenAnswer, keystrokeCount, pasteCount, firstOpenedAt, savedAt } = answer;
    if (snapshot.type === "WRITTEN" && writtenAnswer) {
      const length = [...writtenAnswer.replace(/\s/gu, "")].length;
      if (clipboardBlocked && (keystrokeCount > 0 || pasteCount > 0) && length >= 80 && length > keystrokeCount * 2 + 30) {
        signals.push({ type: "PASTE_BYPASS", severity: "HIGH", attemptQuestionId, details: { characters: length, keystrokeCount } });
      }
      if (normalizedMarker && writtenAnswer.toLowerCase().includes(normalizedMarker)) {
        signals.push({ type: "HONEYPOT_TRIGGERED", severity: "HIGH", attemptQuestionId, details: {} });
      }
    }
    const elapsed = firstOpenedAt && savedAt ? (savedAt.getTime() - firstOpenedAt.getTime()) / 1000 : 0;
    const seconds = answer.timeSpentSeconds || elapsed;
    if (snapshot.difficulty === "HARD" && seconds > 0 && seconds <= 5 && objectiveScore(answer) === 100) {
      signals.push({ type: "FAST_CORRECT_ANSWER", severity: "MEDIUM", attemptQuestionId, details: { seconds } });
    }
  }

  const writtenMatches = new Map<string, number>();
  const wrongPatterns = new Map<string, { matching: number; differing: number }>();
  for (const peer of peers) {
    const target = own.get(peer.questionId);
    if (!target || !comparablePrompt(target.answer.snapshot, peer.snapshot)) continue;
    if (target.words) {
      const other = fingerprint(peer.writtenAnswer);
      if (!other) continue;
      const score = similarity(target.words, other);
      if (score >= 0.85) writtenMatches.set(target.answer.id, Math.max(score, writtenMatches.get(target.answer.id) ?? 0));
    } else if (target.wrong) {
      const other = wrongChoices(peer);
      if (!other) continue;
      const pattern = wrongPatterns.get(peer.peerId) ?? { matching: 0, differing: 0 };
      if (target.wrong === other) pattern.matching++;
      else pattern.differing++;
      wrongPatterns.set(peer.peerId, pattern);
    }
  }

  for (const [attemptQuestionId, score] of writtenMatches) {
    signals.push({
      type: "SIMILAR_ANSWER", severity: "MEDIUM", attemptQuestionId,
      details: { comparison: "written", similarity: Math.round(score * 100) / 100 },
    });
  }
  const matchingChoices = Math.max(0, ...[...wrongPatterns.values()]
    .filter(({ differing }) => differing === 0)
    .map(({ matching }) => matching));
  if (matchingChoices >= 3) {
    signals.push({
      type: "SIMILAR_ANSWER", severity: "MEDIUM",
      details: { comparison: "wrongChoices", matchingQuestions: matchingChoices },
    });
  }
  return signals;
}
