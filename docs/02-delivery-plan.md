# CohortKit roadmap

## Phase 0 — Foundation (done)

- Clean repo, Apache-2.0, CI on push/PR, README, Dockerfile + docker-compose.
- Express + SQLite backend with tenancy, roles, sessions, invitations, audit trail, config-driven cohorts, and the full application → review → selection API.
- Frontend: auth, workspace shell, overview, applications, selection pipeline, reviewer workspace, team, cohort editor (questions/qualifications/rubric/stages), settings & billing, public apply portal, status page, invitation acceptance, application detail (prepare/review/decide).
- 23 API + domain tests green; `npm run check` (typecheck, tests, production build) passes; demo mode verified end to end.

## Phase 1 — Branding and configuration (done)

- Organization branding: name, logo, accent color, footer text, and email sender name driven by workspace settings, rendered on the public portal and transactional emails.
- Public portal polish: deadline countdown and FAQ slots from cohort config.

## Phase 2 — Pluggable email (done)

- `EmailAdapter` interface with Resend and SMTP implementations; console adapter when nothing is configured.
- Emails: invitation, draft continuation, submission receipt, decision, and deadline reminders.
- SQLite outbox with bounded retries, dedupe keys, and an admin email log.

## Phase 3 — AI-assisted setup and briefs (done)

- AI setup wizard: admins describe their program and AI proposes rubric criteria + weights, application questions, qualification checks, stages, and FAQs; every proposal is human-edited and saved. A local keyword-driven proposal generator works without any provider.
- Brief generation against the configured rubric (no fixed criteria) behind an `AiProvider` abstraction so other models can be added.
- AI-drafted rejection/waitlist feedback and cohort review summaries, always human-approved.

## Phase 4 — Operations and scale (done, with one deferral)

- Postgres driver (`server/pg.ts`) with the full schema, all migrations, parameter translation, constraints, and transactions — verified in CI against Postgres 16. Wiring the application server to the async Postgres driver is deferred: SQLite remains the single-host store, and the driver keeps the data layer migration-ready. See [03-operations.md](03-operations.md).
- Offline backups (`npm run backup`) and restore steps, schema-versioned migrations, multi-instance notes (rate limiting), status-link analytics.
- CSV export ships with the applications page.

## Phase 5 — Open-source launch (done except manual steps)

- Screenshots in `docs/images/`, full docs set (assessment, roadmap, operations, releasing, trademark notes).
- CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates, pull request template, release process, CHANGELOG.
- Trademark best-effort check for the CohortKit name recorded in [05-trademark.md](05-trademark.md); professional clearance and filing recommended before commercial launch.
- Remaining manual steps: hosted demo instance, announcement, demo video, and a hosted offering page (Stripe plans are already wired).

## Rollback

Keep the OAIX source untouched. Back up the SQLite database with its online backup API before upgrades. Schema versions use additive migrations; restore an offline backup alongside the matching application version if rollback is necessary. Preserve any real submissions before resetting demo data. Never reset a live database to seed data.