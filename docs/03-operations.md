# Operations guide

CohortKit is a single-process application with one SQLite database. This guide covers backups, upgrades, configuration, and scaling.

## Backups

SQLite's online backup API produces a consistent snapshot while the server runs.

```sh
npm run backup                         # → data/backups/cohortkit-<timestamp>.db
npm run backup /path/to/backup.db      # custom destination
```

Restore:

1. Stop the server.
2. Move the backup file over the live database file (`DATABASE_PATH`).
3. Start the server.

Back up before every upgrade. Keep backups off-machine.

## Upgrades

- Schema changes ship as additive, numbered migrations in `server/db.ts` (versions 2..N). Applied versions are recorded in `schema_versions`; each migration runs once inside a transaction.
- Never edit an applied migration — append a new one.
- The application and database move together: back up before upgrading, and if you roll back the application, restore the matching backup.

## Configuration

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | Bind address |
| `APP_ORIGIN` | Public origin (https in production) |
| `DATABASE_PATH` | SQLite file (default `./data/cohortkit.db`) |
| `DEMO_MODE` | Seed fictional data; localhost only |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | AI drafts for briefs, feedback, summaries, and the setup wizard (optional; local extractive modes work without it) |
| `EMAIL_FROM`, `RESEND_API_KEY` | Resend email delivery |
| `SMTP_HOST/PORT/USER/PASS` | SMTP email delivery |
| `STRIPE_SECRET_KEY` + price IDs | Subscription billing (optional) |

Production requires `NODE_ENV=production`, an HTTPS `APP_ORIGIN`, and `DEMO_MODE=false`. The server enforces these.

## Multi-instance and scaling

SQLite comfortably serves a single-host deployment: an accelerator program handles hundreds of applications and dozens of reviewers, well within SQLite's throughput in WAL mode.

If you run multiple application instances against one database, two features need attention:

- **Rate limiting** is in-memory per process (`express-rate-limit`). Behind a load balancer, each instance applies its own limit. Keep rate-limited routes sticky or move to a shared limiter.
- **SQLite is single-writer**: run one writer instance, or move the database to Postgres.

A Postgres driver (`server/pg.ts`) is included and verified in CI against Postgres 16 — schema, all migrations, parameter translation, constraints, dedupe index, and transactions are tested (`tests/pg.test.ts` runs when `DATABASE_URL` is set). Wiring the application server to the async Postgres driver is a planned change; until then, run the SQLite store.

## Email

Email is queued in an outbox table with bounded retries (5 attempts). Inspect delivery in **Workspace → Email log**. Without a configured provider, email is written to the server console only; invitation and status links always remain copyable in the UI.

## AI safety posture

- Extractive briefs and summaries work offline and only quote the source.
- AI-drafted briefs, feedback, and setup proposals are validated server-side, stored as drafts, and require explicit human approval before use.
- Applicant content is treated as untrusted data in every prompt; AI is never given selection authority.

## Demo mode

`DEMO_MODE=true` (default in development) binds to localhost, seeds a fictional workspace, and offers one-click demo personas. Never enable it in production; the server refuses to start if demo mode binds outside localhost or runs with `NODE_ENV=production`.