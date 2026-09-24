# Source assessment: Oregon AI Accelerator (oregon-ai-quest)

Inspected September 24, 2026 at source commit `7051aab` in `/Users/jackphan/Documents/OAIX/oregon-ai-quest`. The source is a private, single-organization product: public marketing site, CMS, mentor/founder community, and a selection workflow, built on Supabase (Auth, Postgres/RLS, Storage, Deno edge functions), GCP Cloud Run, and Resend. No founder data, credentials, database contents, or brand assets are copied into CohortKit.

CohortKit is a refactored, self-contained open-source rebuild of the application → review → selection workflow, not a fork. Decisions: Apache-2.0, Express + SQLite single-process backend (Postgres adapter planned), config-driven cohort model, tenancy per organization.

## Behaviors preserved from OAIX

- **Review state keyed by application ID** (no rating bleed when moving between applications) — `ReviewForm` is keyed per application.
- **Atomic save-and-next** with optimistic version checks; stale saves return 409 instead of overwriting.
- **Balanced reviewer assignments** with workload-aware coverage and no duplicate reviewer/application pairs (server-side balancing transaction).
- **Weighted 1–5 rubric with separate Champion flag** and per-cohort champion limits (OAIX stored 2–10 scores; CohortKit stores 1–5 directly).
- **Workflow:** submitted → scrubbed (eligibility) → brief (extractive by default; AI draft requires human approval) → pooled → human review → stages → committee decision, with reasoned admin overrides and an immutable audit trail.
- **Conflict recusal** that removes prior reviews and drops the application from the reviewer's queue.
- **Evidence-based AI briefs** adapted from `supabase/functions/_shared/application-analysis.ts`: strict zod validation, quotes verified against source, applicant content treated as untrusted data, no scores or recommendations from AI without human approval.

## What was deliberately not carried over

- Marketing site, CMS, press/portfolio, mentor matching, founder community, chat, events, newsletters, deliverables, and analytics dashboards (out of scope for v1).
- Legacy Lovable sync/migration scripts and one-time data-repair tooling.
- 155 churn-filled schema migrations → replaced with a single clean schema in `server/db.ts`.
- Hardcoded Oregon-specific rubric (`oregon_connection`), form fields, copy, and branding → replaced with per-cohort configurable rubric, questions, qualifications, and stages.
- Live Supabase/Resend/GCP credentials in `.env.local` → never copied; `.env.example` contains placeholders only.

## Where the pieces live

| OAIX source | CohortKit |
|---|---|
| `src/pages/review/PoolReview.tsx` | `src/pages/Reviewer.tsx` (session queue, star rubric, champion, recusal) |
| `src/pages/Apply.tsx` | `src/pages/Intake.tsx` (dynamic questions, draft continuation, private status link) |
| `src/pages/admin/WorkflowDashboardPage.tsx`, `ConsensusPage.tsx` | `src/pages/Dashboard.tsx` (pipeline, applications) + `src/pages/ApplicationDetail.tsx` (preparation, reviews, decisions) |
| `src/lib/reviewerAssignmentQueue.ts`, `assignmentBalancing.ts` | Server-side assignment transaction in `server/api.ts` |
| `supabase/functions/_shared/application-analysis.ts` | `server/analysis.ts` (configurable rubric instead of fixed criteria) |
| `supabase/functions/send-*`, Resend | Planned pluggable email adapter (Resend + SMTP) — invitations are copyable links without email |

## Official references checked

- https://nodejs.org/api/sqlite.html — built-in SQLite and transaction primitives.
- https://expressjs.com/en/guide/migrating-5/ — Express 5 routing/error behavior.
- https://docs.stripe.com/billing/subscriptions/webhooks — subscription lifecycle events.