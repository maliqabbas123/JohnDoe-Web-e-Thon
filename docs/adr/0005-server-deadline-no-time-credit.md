# 5. A fixed server-side deadline with no pause and no time credit

- Status: Accepted
- Date: 2026-11-27

## Context

Timing must not depend on the candidate's device clock. The brief also asks for resilience to outages without allowing candidates to gain extra time. Crediting back time lost to a disconnection was considered and rejected: the server can measure a gap in contact, but not whether the candidate was unable to work, so a deliberate disconnection would earn extra thinking time.

## Decision

Fix `deadlineAt` when the attempt starts as the earlier of start plus duration and the slot end. Never move it. Reject saves after it. At the deadline the attempt closes and the last state saved on the server is submitted. Expired attempts are closed lazily on the next read. Gaps in contact are recorded as `Disruption` rows for the examiner, who may issue a retake grant.

## Consequences

- Refreshing, changing the device clock or disconnecting cannot gain time.
- No background worker is needed.
- Work typed during an outage on the open question is lost if the connection does not return before the deadline. The remedy is a retake, decided by a person.
- Resilience comes from frequent autosave, repeat-safe saves and resuming on any device.
