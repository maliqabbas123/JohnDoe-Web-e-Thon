// The contract every exam module shares: what a frozen question looks like
// inside an attempt, what a candidate may see of it, and how an objective
// answer is scored. Pure functions with no database access, so the attempt,
// grading, results, dispute and integrity modules all use the same rules.

export type QuestionType = "SINGLE_CHOICE" | "MULTIPLE_SELECT" | "WRITTEN";
export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type MultiSelectScoring = "ALL_OR_NOTHING" | "PARTIAL";

export type SnapshotOption = { id: string; text: string; isCorrect: boolean };

// Stored in AttemptQuestion.snapshot when an attempt starts. It is a copy:
// later edits to the question bank never reach it.
export type PaperSnapshot = {
  version: 1;
  type: QuestionType;
  difficulty: Difficulty;
  topic: { id: string; name: string };
  text: string;
  // Empty for a written-response question.
  options: SnapshotOption[];
  multiSelectScoring: MultiSelectScoring;
  // Added when a dispute shows the question had another valid answer. Each
  // entry is a set of option ids that is also accepted as fully correct.
  alsoAccepted?: string[][];
  // Set when a dispute shows the question was unanswerable: everyone who was
  // served it receives full marks.
  voided?: boolean;
};

// What the exam page receives. The answer key is removed and the options are
// put in the order chosen for this candidate.
export type CandidateQuestion = {
  type: QuestionType;
  text: string;
  options: { id: string; text: string }[];
};

export function toCandidateQuestion(snapshot: PaperSnapshot, optionOrder: string[]): CandidateQuestion {
  const byId = new Map(snapshot.options.map((option) => [option.id, option]));
  const ordered = optionOrder
    .map((id) => byId.get(id))
    .filter((option): option is SnapshotOption => option !== undefined);
  return {
    type: snapshot.type,
    text: snapshot.text,
    options: ordered.map(({ id, text }) => ({ id, text })),
  };
}

const roundMarks = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const sameSet = (left: string[], right: string[]) =>
  left.length === right.length && left.every((id) => right.includes(id));

// Marks earned for an objective question, or null for a written response,
// which an examiner grades by hand.
//
//   Single choice    full marks for the one correct option, otherwise zero.
//   Multiple select  ALL_OR_NOTHING: full marks only for exactly the correct set.
//                    PARTIAL: each correct pick earns an equal share and each
//                    wrong pick cancels one share, never going below zero.
//
// Option ids that are not part of the question are ignored, and repeated
// ids count once, so a crafted request cannot inflate a score.
export function scoreObjective(
  snapshot: PaperSnapshot,
  selectedOptionIds: string[],
  marks: number,
): number | null {
  if (snapshot.voided) return roundMarks(marks);
  if (snapshot.type === "WRITTEN") return null;

  const known = new Set(snapshot.options.map((option) => option.id));
  const selected = [...new Set(selectedOptionIds)].filter((id) => known.has(id));
  const correct = snapshot.options.filter((option) => option.isCorrect).map((option) => option.id);

  if (selected.length === 0) return 0;
  if (sameSet(selected, correct)) return roundMarks(marks);
  if (snapshot.alsoAccepted?.some((accepted) => sameSet(selected, accepted))) return roundMarks(marks);

  if (snapshot.type === "SINGLE_CHOICE" || snapshot.multiSelectScoring === "ALL_OR_NOTHING") return 0;

  const right = selected.filter((id) => correct.includes(id)).length;
  const wrong = selected.length - right;
  const share = Math.max(0, right - wrong) / correct.length;
  return roundMarks(marks * share);
}

// The score that counts for one question: an examiner's mark overrides the
// automatic one. Null means it still needs grading.
export function effectiveScore(autoScore: number | null, manualScore: number | null): number | null {
  return manualScore ?? autoScore;
}
