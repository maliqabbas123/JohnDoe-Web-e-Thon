# 2. Server-side sessions in an HttpOnly cookie

- Status: Accepted
- Date: 2026-11-27

## Context

Three roles sign in. Sessions must end immediately when an account is deactivated, a role changes, a password changes, or the same candidate signs in elsewhere during an exam.

## Decision

Issue a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production). Store only its SHA-256 hash in the `Session` table with an expiry. Every request looks the session up.

## Consequences

- Sessions can be revoked instantly, which self-contained tokens such as JWTs cannot do without a deny-list.
- Script running in the page cannot read the token, and a database leak does not expose usable tokens.
- One indexed lookup per request.
- Cookies need an origin check on state-changing requests to prevent cross-site request forgery.
