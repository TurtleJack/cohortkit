# CohortKit roadmap

## Phase 0 — Foundation (done)

- Clean repo, Apache-2.0, CI on push/PR, README, Dockerfile + docker-compose.
- Express + SQLite backend with tenancy, roles, sessions, invitations, audit trail, config-driven cohorts, and the full application → review → selection API.
- Frontend: auth, workspace shell, overview, applications, selection pipeline, reviewer workspace, team, cohort editor (questions/qualifications/rubric/stages), settings & billing, public apply portal, status page, invitation acceptance, application detail (prepare/review/decide).
- 23 API + domain tests green; `npm run check` (typecheck, tests, production build) passes; demo mode verified end to end.

## Phase 1 — Branding and configuration

- Organization branding: name, logo, accent color, footer text, and email sender name driven by workspace settings, rendered on the public portal and transactional emails.
- Public portal polish: program description sections, deadline countdown, FAQ slots from cohort config.

## Phase 2 — Pluggable email

- `EmailAdapter` interface with Resend and SMTP implementations; console adapter in demo mode.
- Emails: invitation, draft continuation, submission receipt, status/decision notification, deadline reminders.
- Queueing in SQLite with retry, and admin email log (modeled on OAIX's `emails_sent`).

## Phase 3 — AI-assisted setup and briefs

- AI setup wizard: admins describe their program and AI proposes rubric criteria + weights, application questions, qualification checks, and stage labels; every proposal is human-edited and saved as a cohort config draft.
- Brief generation against the configured rubric (no fixed criteria); provider abstraction so Anthropic/local models can be added.
- Optional AI-drafted rejection feedback and shortlist summaries, always human-approved.

## Phase 4 — Operations and scale

- Postgres adapter behind the repository interface (SQLite stays the default for single-host).
- Backups and restore docs, schema-versioned migrations, multi-instance notes (shared rate limiting).
- CSV export parity checks and status-link analytics.

## Phase 5 — Open-source launch

- Docs site with screenshots and a 5-minute demo video; hosted demo instance.
- CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md, issue templates, release process.
- Trademark check for the CohortKit name; final license attribution review.
- Public GitHub repo, announcement, and a hosted offering page (Stripe plans already wired).

## Rollback

Keep the OAIX source untouched. Back up the SQLite database with its online backup API before upgrades. Schema versions use additive migrations; restore an offline backup alongside the matching application version if rollback is necessary. Preserve any real submissions before resetting demo data. Never reset a live database to seed data.