# Changelog

## 0.1.0 (unreleased)

Initial open-source release.

### Application, review, and selection

- Public application portal with configurable questions, qualification checks, draft continuation, private status links, and deadline countdown
- Configurable weighted rubrics (1–5 stars), stages, pools, capacities, champion limits, blind review, and FAQ slots per cohort
- Reviewer workspace with session queue, atomic save-and-next, conflict recusal, and Champion flags
- Selection pipeline with coverage rules, reasoned admin overrides, capacity-checked decisions, and immutable audit trail
- Team management with invitation links, roles, and balanced reviewer assignments

### AI (assistant-only)

- Extractive source briefs that work offline
- AI-drafted briefs with mandatory human approval and source-verified citations
- AI setup wizard: describe your program, review and edit the proposed rubric/questions/stages, then save
- Rejection/waitlist feedback drafts and cohort review summaries, human-approved

### Operations

- Tenant isolation per organization with server-enforced roles and sessions
- Pluggable transactional email: Resend, SMTP, or console, with an outbox, bounded retries, dedupe keys, and deadline reminders
- Offline backups via `npm run backup`
- Demo mode with seeded fictional data
- Postgres driver verified in CI (SQLite is the default single-host store)
- Status-link analytics

### Packaging

- Apache-2.0, Dockerfile + docker-compose, CI (SQLite + Postgres jobs), documentation