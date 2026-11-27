import type { Difficulty, MultiSelectScoring } from "./paper";

export const difficulties = ["EASY", "MEDIUM", "HARD"] as const satisfies readonly Difficulty[];

type ExamSlot = {
  status: "DRAFT" | "PUBLISHED" | "COMPLETED";
  startsAt: Date;
  endsAt: Date;
};

export type ExamState = ExamSlot["status"] | "ONGOING";

export function calculateExamState(exam: ExamSlot, now = new Date()): ExamState {
  if (exam.status !== "PUBLISHED" || now < exam.startsAt) return exam.status;
  return now <= exam.endsAt ? "ONGOING" : "COMPLETED";
}

// Percentages must total 100. Equal remainders are awarded in difficulty
// order so review and the eventual paper draw always agree.
export function difficultyCounts(questionCount: number, percentages: Record<Difficulty, number>) {
  const allocations = difficulties.map((difficulty) => {
    const weight = questionCount * percentages[difficulty];
    return { difficulty, count: Math.floor(weight / 100), remainder: weight % 100 };
  });
  const remaining = questionCount - allocations.reduce((sum, rule) => sum + rule.count, 0);
  const counts = { EASY: 0, MEDIUM: 0, HARD: 0 };
  allocations.sort((left, right) => right.remainder - left.remainder);
  for (const [index, rule] of allocations.entries()) {
    counts[rule.difficulty] = rule.count + Number(index < remaining);
  }
  return counts;
}

const integrityRules = {
  desktopOnly: "Use a desktop browser to take this exam.",
  blockClipboard: "Copy, cut and paste are blocked. Attempts to use them may be recorded.",
  blockContextMenu: "Right-click and developer-tool shortcuts are blocked and may be recorded.",
  requireFullscreen: "Stay in full screen. Exits are recorded.",
  detectExtraDisplay: "An extra display may be reported where your browser supports detection.",
  watermark: "The exam page displays a watermark with your candidate identifier.",
  aiNotice: "Each question displays a notice that AI assistants must not answer it.",
  honeypot: "Question content may include an integrity marker. Do not submit the marker as an answer.",
};

type RulesSettings = Omit<ExamSlot, "status"> & Record<keyof typeof integrityRules, boolean> & {
  durationMinutes: number;
  maxAttempts: number | null;
  resultPolicy: "BEST" | "LATEST";
  selectionMode: "FIXED" | "BALANCED";
  multiSelectScoring: MultiSelectScoring;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  totalMarks: number | { toString(): string };
};

export function examRules(exam: RulesSettings) {
  const statements = [
    "Your attempt ends at the earlier of your time allowance or the end of your slot. Your last saved answers are submitted at that deadline.",
    exam.maxAttempts === null
      ? "There is no attempt limit."
      : `The exam allows up to ${exam.maxAttempts} attempt${exam.maxAttempts === 1 ? "" : "s"} in the main slot.`,
    exam.resultPolicy === "BEST"
      ? "Your highest-scoring attempt counts. If scores tie, the earlier attempt counts."
      : "Your latest attempt counts.",
    exam.selectionMode === "BALANCED"
      ? "Questions are drawn for each attempt. Every paper has the same number of questions at each difficulty and the same total marks."
      : "Every paper contains the same set of questions.",
    exam.multiSelectScoring === "PARTIAL"
      ? "For multiple-select questions, correct choices earn equal shares and each wrong choice cancels one share, down to zero."
      : "For multiple-select questions, select exactly all the correct choices to earn marks.",
    "The system records timing and integrity signals for examiner review. It does not record your camera, microphone or screen. Signals do not change your score.",
  ];
  if (exam.shuffleQuestions) statements.push("Question order is shuffled.");
  if (exam.shuffleOptions) statements.push("Answer options are shuffled.");
  for (const key of Object.keys(integrityRules) as (keyof typeof integrityRules)[]) {
    if (exam[key]) statements.push(integrityRules[key]);
  }
  return {
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    durationMinutes: exam.durationMinutes,
    maxAttempts: exam.maxAttempts,
    resultPolicy: exam.resultPolicy,
    selectionMode: exam.selectionMode,
    multiSelectScoring: exam.multiSelectScoring,
    totalMarks: Number(exam.totalMarks),
    statements,
  };
}
