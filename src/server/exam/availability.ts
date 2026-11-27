type Window = { startsAt: Date; endsAt: Date };

export type CandidateExam = Window & {
  status: "DRAFT" | "PUBLISHED" | "COMPLETED";
  maxAttempts: number | null;
};

export type CandidateRetake = Window & {
  id: string;
  attemptsAllowed: number;
  revokedAt: Date | null;
};

export type ActiveExamAttempt = {
  id: string;
  retakeGrantId: string | null;
  deadlineAt: Date;
};

export type CandidateExamStatus = "UPCOMING" | "AVAILABLE" | "IN_PROGRESS" | "COMPLETED";
type Slot = Window & {
  retakeGrantId: string | null;
  attemptsAllowed: number | null;
  attemptsUsed: number;
};

function byEndingSooner(a: Slot, b: Slot) {
  return +a.endsAt - +b.endsAt || (a.retakeGrantId ?? "").localeCompare(b.retakeGrantId ?? "");
}

// Attempt counts are per slot. Expired attempts still consume a try, even
// before the attempt service writes their terminal status.
export function candidateExamAvailability(
  exam: CandidateExam,
  retakes: readonly CandidateRetake[],
  usage: ReadonlyMap<string | null, number>,
  active: ActiveExamAttempt | null,
  now: Date,
) {
  const main: Slot = {
    retakeGrantId: null,
    startsAt: exam.startsAt,
    endsAt: exam.endsAt,
    attemptsAllowed: exam.maxAttempts,
    attemptsUsed: usage.get(null) ?? 0,
  };
  const summary = {
    attemptsUsed: main.attemptsUsed,
    maxAttempts: main.attemptsAllowed,
    totalAttemptsUsed: [...usage.values()].reduce((sum, count) => sum + count, 0),
  };
  function result(status: CandidateExamStatus, slot: Slot | null, attempt: ActiveExamAttempt | null = null) {
    return {
      ...summary,
      status,
      slot,
      activeAttemptId: attempt?.id ?? null,
      deadlineAt: attempt?.deadlineAt ?? null,
    };
  }

  const retakeSlot = (grant: CandidateRetake): Slot => ({
    retakeGrantId: grant.id,
    startsAt: grant.startsAt,
    endsAt: grant.endsAt,
    attemptsAllowed: grant.attemptsAllowed,
    attemptsUsed: usage.get(grant.id) ?? 0,
  });
  if (exam.status === "DRAFT") return result("COMPLETED", null);
  if (active && active.deadlineAt > now) {
    const retake = retakes.find((grant) => grant.id === active.retakeGrantId);
    return result("IN_PROGRESS", retake ? retakeSlot(retake) : active.retakeGrantId === null ? main : null, active);
  }

  const slots = retakes.filter((grant) => grant.revokedAt === null).map(retakeSlot);
  if (exam.status === "PUBLISHED") slots.push(main);
  const eligible = slots.filter(({ endsAt, attemptsAllowed, attemptsUsed }) =>
    endsAt > now && (attemptsAllowed === null || attemptsUsed < attemptsAllowed),
  );
  const open = eligible.filter(({ startsAt }) => startsAt <= now);
  const available = open.find(({ retakeGrantId }) => retakeGrantId === null) ?? open.sort(byEndingSooner)[0];
  if (available) return result("AVAILABLE", available);

  const upcoming = eligible.sort((a, b) => +a.startsAt - +b.startsAt || byEndingSooner(a, b))[0];
  return upcoming ? result("UPCOMING", upcoming) : result("COMPLETED", null);
}
