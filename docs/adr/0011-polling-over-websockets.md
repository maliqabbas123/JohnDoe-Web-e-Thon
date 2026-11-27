# 11. Polling instead of WebSockets

- Status: Accepted
- Date: 2026-11-27

## Context

Examiners need a live view of attempts, and candidates need announcements during an exam. The serverless host does not keep long-lived connections.

## Decision

The candidate's heartbeat, sent every 15 seconds, returns new announcements together with the server time and deadline. The examiner's monitoring view polls a snapshot endpoint every few seconds.

## Consequences

- Works on any host with no extra infrastructure.
- Updates are delayed by up to one polling interval, which is acceptable here.
- The heartbeat doubles as the contact signal for disruption records.
