# 9. Disputes decided by the examiner, with a permanent score history

- Status: Accepted
- Date: 2026-11-27

## Context

Candidates may dispute results because of grading errors, faulty questions or technical incidents (innovation challenge 5.4). The process must be transparent and accountable, and published results must stay trustworthy.

## Decision

A candidate disputes their own released result inside a window the examiner sets in hours. They see their whole attempt, select one or more questions, choose a category, explain, and may attach one document. The exam's examiner alone decides each question, with a written reason. There is no appeal. Outcomes: a regrade, a fix applied to every candidate who had a faulty question without lowering any score, or a retake grant. Every score change writes a `GradeChange` row and supersedes the issued report.

## Consequences

- Each decision has a named decision-maker and a recorded reason.
- A published score is never changed silently.
- One decision-maker is simple and fast, at the cost of no independent second review.
- Attachments are a new attack surface, limited by type, size and content checks.
