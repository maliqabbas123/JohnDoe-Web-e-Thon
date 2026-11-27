# 10. Privacy-first integrity signals, not verdicts

- Status: Accepted
- Date: 2026-11-27

## Context

AI assistants and messaging make online exams hard to run fairly (innovation challenge 5.1). The brief asks for better integrity without unnecessarily compromising privacy, and states that monitoring indicators must not be treated as conclusive evidence. Browser restrictions can be switched off by a determined candidate.

## Decision

Collect no camera, microphone or screen recording. Combine three layers: different papers per candidate; exam-page restrictions that block and report copying, pasting, right-click, leaving the window and extra displays; and server-side analysis that cannot be switched off: answer speed, typing counts against answer length, similarity between candidates, and a per-attempt honeypot marker for AI assistants. Each question also carries a visible notice that AI assistants must not answer. Signals are stored as incidents with a severity and summarised per attempt for the examiner.

## Consequences

- No sensitive media is stored, and nothing depends on a paid service.
- Signals never change a score; the examiner reviews and records a conclusion.
- A second device pointed at the screen is not detectable.
- Candidates are told before the exam exactly what is recorded.
