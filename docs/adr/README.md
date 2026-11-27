# Architecture decision records

Each record states the context, the decision and its consequences, in the format described by Michael Nygard. Records are numbered and never rewritten; a changed decision gets a new record that supersedes the old one.

| # | Decision | Status |
|---|---|---|
| [0001](0001-stack.md) | Next.js, TypeScript, Prisma and PostgreSQL | Accepted |
| [0002](0002-server-side-sessions.md) | Server-side sessions in an HttpOnly cookie | Accepted |
| [0003](0003-derived-ongoing-state.md) | The ongoing state of an exam is calculated, not stored | Accepted |
| [0004](0004-frozen-paper.md) | The paper is frozen when an attempt starts | Accepted |
| [0005](0005-server-deadline-no-time-credit.md) | A fixed server-side deadline with no pause and no time credit | Accepted |
| [0006](0006-one-question-at-a-time.md) | Questions are delivered one at a time and never cached | Accepted |
| [0007](0007-attempts-and-retakes.md) | Configurable attempts, retake grants and a result policy | Accepted |
| [0008](0008-balanced-papers.md) | Difficulty-balanced random papers | Accepted |
| [0009](0009-disputes.md) | Disputes decided by the examiner, with a permanent score history | Accepted |
| [0010](0010-integrity-signals.md) | Privacy-first integrity signals, not verdicts | Accepted |
| [0011](0011-polling-over-websockets.md) | Polling instead of WebSockets | Accepted |
