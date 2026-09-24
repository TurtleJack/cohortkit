# Security policy

## Reporting a vulnerability

Do not open a public issue. Email the maintainers directly with:

- A description of the vulnerability and its impact
- Steps to reproduce, if available
- Any proposed remediation

We will acknowledge receipt within 5 business days and aim to publish a fix and an advisory within 30 days. We will credit reporters who wish to be credited.

## Scope

The CohortKit application: the server (`server/`), shared domain (`shared/`), frontend (`src/`), and deployment configuration at the repository root. Third-party npm dependencies are in scope only insofar as CohortKit uses them incorrectly.

## Supported versions

Only the latest release is supported with security fixes. Self-hosters should upgrade promptly; see [docs/03-operations.md](docs/03-operations.md) for backup and upgrade steps.

## Security model

- Access control is enforced server-side on every private route; roles are checked per organization.
- Sessions are HTTP-only, SameSite=Lax cookies, hashed at rest; passwords are salted and hashed with scrypt.
- All mutating requests must originate from the configured origin and use `application/json`.
- Authentication and public routes are rate-limited.
- AI prompts treat all applicant content as untrusted data; AI output is draft-only until a human approves it, and AI citations are verified against the source before saving.
- Demo mode refuses to bind anywhere except localhost and refuses to start in production.

## What not to report

- Denial-of-service from an actor with legitimate admin access to their own instance
- Social-engineering attacks against self-hosters
- Vulnerabilities in your own deployment configuration (e.g., running production without HTTPS)