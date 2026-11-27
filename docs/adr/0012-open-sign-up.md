# 12. Open sign-up for candidates and examiners

- Status: Accepted
- Date: 2026-11-27

## Context

The platform is meant for any institution or organiser, not one institution with a fixed staff list. Accounts were first created by an administrator only, which blocks anyone from simply registering to hold or take an exam. The concern with open registration is privilege: letting a person choose their own role.

In this system an examiner owns their question bank and their exams and can see nothing that belongs to another examiner. A candidate sees only exams they are enrolled in. A newly registered account of either kind therefore has access to nothing but an empty space of its own.

## Decision

Anyone may sign up as a candidate or an examiner, and the account is active at once. The sign-up endpoint accepts only those two values; an administrator account can be created only by the seed script or by another administrator. Sign-in is unchanged: the server reads the role from the account, and no role is ever accepted from the client when signing in.

Candidates join an exam by a join code the examiner shares, or by being enrolled by email or bulk import. Examiners cannot browse or search platform users; they see only the candidates enrolled in their own exams.

Organisations, meaning several examiners sharing one bank or one set of exams, are out of scope.

## Consequences

- Registration needs no administrator, which suits a universal platform and makes the system easy to try.
- The administrator becomes a platform operator: oversight, deactivating abusive accounts, changing roles and reading the audit log.
- There is no email service, so addresses are not verified. Fake accounts are possible; sign-up is rate-limited per address and accounts can be deactivated.
- The sign-up response reveals whether an email is already registered. Without email there is no way to avoid this; the rate limit bounds how fast addresses can be probed.
- Any future sharing between examiners must be with named examiners only. A library open to all examiners would expose answer keys to a candidate who registers a second account as an examiner.
