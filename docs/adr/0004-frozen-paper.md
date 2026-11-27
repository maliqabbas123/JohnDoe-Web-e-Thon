# 4. The paper is frozen when an attempt starts

- Status: Accepted
- Date: 2026-11-27

## Context

Examiners edit questions over time. The brief requires the assigned questions and marking scheme to be preserved for an active attempt, and grading must be reproducible when a result is disputed later.

## Decision

When an attempt starts, copy each served question into `AttemptQuestion.snapshot`: text, options, accepted answers, marks and the order shown. Grade only from the snapshot.

## Consequences

- Editing or archiving a bank question never changes an existing paper or its score.
- A dispute can be reviewed against exactly what the candidate saw.
- More storage per attempt, which is small at this scale.
- A fix for a faulty question must update the snapshots of the affected attempts, which is done explicitly and recorded in `GradeChange`.
