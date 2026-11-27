# 1. Next.js, TypeScript, Prisma and PostgreSQL

- Status: Accepted
- Date: 2026-11-27

## Context

The application must be full-stack, deployed, and built in 10 hours without paid services. The data is strongly relational: users, exams, questions, enrolments, attempts, answers and grades all reference each other, and the brief scores database design and data integrity.

## Decision

Build the API as Next.js route handlers in TypeScript, with Prisma as the data layer and PostgreSQL as the only data store. Sessions, rate-limit counters and uploaded documents also live in PostgreSQL.

## Consequences

- One codebase and one deployment; types are shared from the database to the API.
- Relational constraints, transactions and partial indexes are available for integrity rules.
- A serverless host has no long-lived connections or background workers, which shapes ADR 0005 and ADR 0011.
- Alternatives considered: FastAPI with a separate frontend (stronger validation defaults and WebSockets, but two deployments and no shared types), a hosted backend-as-a-service (fast start, but permissions move into database policies that are harder to explain), and MongoDB (weaker fit for relational data).
