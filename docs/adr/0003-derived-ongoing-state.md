# 3. The ongoing state of an exam is calculated, not stored

- Status: Accepted
- Date: 2026-11-27

## Context

The brief names four exam states: draft, published, ongoing and completed. Ongoing depends on the clock. Storing it needs something to change the value at the exact start and end times, and the host has no background worker. With retake slots, an exam can also be available to one candidate while completed for everyone else.

## Decision

Store `DRAFT`, `PUBLISHED` and `COMPLETED`. Calculate ongoing on every request from the status, the slot and the server clock. The API always reports one of the four states, and reports each candidate's own availability separately.

## Consequences

- The state can never be stale or disagree with the clock.
- No scheduler is needed.
- Queries for ongoing exams filter on status and slot instead of one column.
- An attempt's in-progress state is a different thing and is stored on the attempt.
