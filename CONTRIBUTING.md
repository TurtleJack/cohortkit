# Contributing to CohortKit

Thank you for helping improve CohortKit. This guide covers how to set up the project, what to work on, and how changes get reviewed.

## Getting started

Requirements: Node.js 24+.

```sh
git clone <repo-url>
cd cohortkit
npm install
npm run dev        # http://localhost:3100 — demo mode with fictional data
```

`npm run check` runs the full gate: typecheck, tests, and the production build. Run it before opening a pull request.

## How decisions are made

CohortKit's core principle: **every selection decision stays human.** Features that move decision-making into the AI assistant's hands are out of scope. AI output is always a draft until a human approves it.

## Areas to work on

Small, self-contained improvements are the easiest to review:

- **Documentation**: setup guides, deployment walkthroughs, translations.
- **Provider adapters**: new AI providers (server/ai.ts) or email providers (server/email.ts).
- **Testing**: end-to-end flows, accessibility passes, Postgres coverage.
- **Bug fixes** with a failing test first.

For larger features, open an issue describing the problem before writing code.

## Conventions

- TypeScript strict; no `any` unless unavoidable.
- Dense, compact React consistent with the existing pages.
- API handlers enforce access server-side with zod validation; never trust client input.
- Schema changes are additive, numbered migrations in `server/db.ts`. Never edit an applied migration.
- Tests live in `tests/` — vitest with supertest against the in-memory store.

## Pull requests

1. Open an issue or comment on an existing one.
2. Branch, implement with tests, and run `npm run check`.
3. Open a PR with a clear description of the problem and your approach.
4. CI runs the SQLite suite and a Postgres 16 service-container job.

## Code of conduct

All participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).