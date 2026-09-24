# CohortKit

**The open-source operating system for accelerators, incubators, and entrepreneur support organizations.**

CohortKit helps you run your program's selection process with clarity: publish a branded application portal, prepare applications, put the right reviewers on every application, and make final decisions with an audit trail. AI stays in an assistant role — every decision stays human.

Built from the workflow proven by the Oregon AI Accelerator's 2026 cohort process (175 applications → 20 accepted).

## Features

- **Configurable intake** — build application questions, qualification checks, deadlines, and capacity per cohort. Everything is data-driven: no code changes to run your program.
- **Weighted scoring rubrics** — define your own criteria and weights per cohort (1–5 stars), not a fixed template.
- **Review workflow** — assigned or pool-based review, balanced reviewer assignments, conflict recusal, Champion designation, atomic save-and-next with keyboard actions.
- **Selection pipeline** — stages from screening to final selection, coverage rules, reasoned admin overrides, capacity-checked decisions.
- **AI in an assistant role** — extractive source briefs (no hallucination) plus optional AI-drafted briefs with human approval. AI output is always a draft until a human approves it.
- **Tenancy & security** — each organization gets its own workspace, roles (owner/admin/committee/reviewer), server-enforced access, HTTP-only sessions, invitation capabilities, and an immutable audit trail.
- **Self-hostable** — a single Node process and one SQLite database. No cloud services required.

## Quickstart

### With Docker (recommended)

```sh
docker compose up
# open http://localhost:3100
```

Create your workspace with a name and password — no external services needed.

### Local development

Requirements: Node.js 24+.

```sh
npm install
npm run dev       # http://localhost:3100 (demo mode: explore with fictional data)
```

In development, demo mode seeds fictional applications and offers one-click demo personas on the login page. Set `DEMO_MODE=false` to start a clean instance.

## Configuration

Copy `.env.example` to `.env`. Key settings:

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | Bind address (default `3100` / `127.0.0.1`) |
| `APP_ORIGIN` | Public origin of the application (required for production) |
| `DATABASE_PATH` | SQLite file (default `./data/cohortkit.db`) |
| `DEMO_MODE` | Seed fictional demo data; only allowed on localhost |
| `OPENAI_API_KEY` | Enables AI-drafted briefs (explicit admin action) |
| `STRIPE_SECRET_KEY` + price IDs | Enables subscription billing (optional) |

See [docs/](docs/) for the delivery plan and architecture decisions.

## How the workflow works

1. **Intake** — founders apply through your branded portal. Drafts continue across sessions via a private link.
2. **Preparation** — an admin scrubs each application for completeness and eligibility, then generates an evidence-based brief (extractive by default; optional AI draft, always human-approved).
3. **Review** — reviewers get balanced, conflict-free queues. Weighted rubric scores, notes, and Advance/Waitlist/Reject with a separate Champion flag.
4. **Selection** — applications move through configurable stages. Committee members record interviews and final decisions; capacity limits are enforced.
5. **Audit** — every change is recorded with its actor and reason.

## License

Apache-2.0. See [LICENSE](LICENSE).

## Status

Early development. The core workflow is functional end-to-end with demo data; see [docs/02-delivery-plan.md](docs/02-delivery-plan.md) for the roadmap. Contributions welcome.