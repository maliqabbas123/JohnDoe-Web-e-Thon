# Secure Examination Management System

Web-e-Thon entry (Technoverse 5.0). A full-stack application for creating, conducting, monitoring and evaluating online examinations.

## Stack

- Next.js 16 (App Router) and React 19, TypeScript
- Tailwind CSS 4
- PostgreSQL 16 with Prisma 7

## Local setup

Requirements: Node.js 20 or newer, and Docker.

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

The app runs at http://localhost:3000. `GET /api/v1/health` reports whether the server can reach the database.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Production build |
| `npm run lint` | Lint the code |
| `npm run db:up` | Start the local PostgreSQL container (port 5434) |
| `npm run db:migrate` | Apply schema changes and create a migration |
| `npm run db:studio` | Browse the database |

## Documentation

Design documents are in [`docs/`](docs/README.md): architecture (C4), data model with data dictionary, API, security threat model and decision records.

## Status

Foundation and design are in place: data model, shared server code and the health endpoint. Feature modules, test credentials for each role and the innovation challenge write-up are added as they are built.
