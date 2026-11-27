import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateExamAvailability, type CandidateExam, type CandidateRetake,
} from "./availability";

const date = (hour: number) => new Date(Date.UTC(2026, 10, 27, hour));
const exam: CandidateExam = { status: "PUBLISHED", startsAt: date(10), endsAt: date(11), maxAttempts: 2 };
const grant: CandidateRetake = { id: "retake", startsAt: date(12), endsAt: date(13), attemptsAllowed: 2, revokedAt: null };

describe("candidate exam availability", () => {
  it("treats the start as open and the end as closed, and handles unlimited attempts", () => {
    assert.equal(candidateExamAvailability(exam, [], new Map(), null, date(9)).status, "UPCOMING");
    assert.equal(candidateExamAvailability(exam, [], new Map(), null, date(10)).status, "AVAILABLE");
    assert.equal(candidateExamAvailability(exam, [], new Map(), null, date(11)).status, "COMPLETED");
    const usage = new Map([[null, 30]]);
    assert.equal(candidateExamAvailability(exam, [], usage, null, date(10)).status, "COMPLETED");
    assert.equal(candidateExamAvailability({ ...exam, maxAttempts: null }, [], usage, null, date(10)).status, "AVAILABLE");
  });

  it("keeps retake allowances separate from the main allowance and skips exhausted or revoked grants", () => {
    const completed = { ...exam, status: "COMPLETED" } as const;
    const usage = new Map([[null, 2], ["retake", 1]]);
    assert.equal(candidateExamAvailability(completed, [grant], usage, null, date(11)).status, "UPCOMING");
    const available = candidateExamAvailability(completed, [grant], usage, null, date(12));
    assert.equal(available.status, "AVAILABLE");
    assert.equal(available.slot?.retakeGrantId, grant.id);
    assert.equal(available.slot?.attemptsUsed, 1);
    assert.equal(available.totalAttemptsUsed, 3);
    assert.equal(candidateExamAvailability(completed, [{ ...grant, revokedAt: date(11) }], usage, null, date(12)).status, "COMPLETED");
    usage.set("retake", 2);
    assert.equal(candidateExamAvailability(completed, [grant], usage, null, date(12)).status, "COMPLETED");
  });

  it("prefers the open main slot, then the retake that ends first", () => {
    const longer = { ...grant, startsAt: date(9), endsAt: date(13) };
    const shorter = { ...longer, id: "shorter", endsAt: date(11) };
    assert.equal(candidateExamAvailability(exam, [longer, shorter], new Map(), null, date(10)).slot?.retakeGrantId, null);
    assert.equal(candidateExamAvailability(exam, [longer, shorter], new Map([[null, 2]]), null, date(10)).slot?.retakeGrantId, "shorter");
  });

  it("resumes live attempts and treats an expired one as used without offering to resume it", () => {
    const active = { id: "active", retakeGrantId: null, deadlineAt: date(11) };
    const usage = new Map([[null, 2]]);
    const result = candidateExamAvailability(exam, [grant], usage, active, date(10));
    assert.equal(result.status, "IN_PROGRESS");
    assert.equal(result.activeAttemptId, active.id);
    assert.equal(result.deadlineAt, active.deadlineAt);
    const afterDeadline = candidateExamAvailability(exam, [grant], usage, active, date(11));
    assert.equal(afterDeadline.status, "UPCOMING");
    assert.equal(afterDeadline.activeAttemptId, null);
  });
});
