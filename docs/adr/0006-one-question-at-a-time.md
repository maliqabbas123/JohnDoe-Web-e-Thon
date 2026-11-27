# 6. Questions are delivered one at a time and never cached

- Status: Accepted
- Date: 2026-11-27

## Context

Sending the whole paper at the start lets a candidate work through an outage, but puts every question in the browser from the first second and makes timing depend on what the page reports. Security is the first quality goal.

## Decision

The server delivers one question per request, by position, with `Cache-Control: no-store`. The frontend keeps only the question on screen. Navigation uses the application's own controls; each move is a request. The server records when each question was opened and how long it stayed open.

## Consequences

- A candidate who goes offline has only the question on screen.
- Time per question is measured by the server and cannot be faked, which feeds the answer-speed analysis.
- Navigation needs a connection. This limits how much can be done during an outage, which is accepted.
- More requests per attempt, each of them small.
