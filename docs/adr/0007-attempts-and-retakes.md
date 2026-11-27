# 7. Configurable attempts, retake grants and a result policy

- Status: Accepted
- Date: 2026-11-27

## Context

Some exams allow one attempt, others several. Sometimes one candidate needs to sit again at a different time, and the others must not see the exam as available. Earlier attempts must be kept.

## Decision

The examiner sets `maxAttempts` per exam, from 1 to unlimited, and may change it later. Every attempt is its own numbered row. A retake for specific candidates is a `RetakeGrant` row with its own slot, reason and issuer. The examiner chooses whether the result is the best or the latest attempt, and candidates are told.

## Consequences

- Full history of attempts and slots is kept.
- Only the candidate with a grant sees the exam as available again.
- A partial unique index guarantees one attempt in progress at a time.
- Result queries must pick the attempt according to the policy.
