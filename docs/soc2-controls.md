# SOC 2 Type II — Controls Reference

This document maps Packd's technical controls to the SOC 2 Trust Services Criteria (TSC). It is intended as a starting point for an auditor-facing narrative, not a substitute for a formal assessment.

---

## CC6 — Logical and Physical Access Controls

### CC6.1 — Access control policies

| Control | Implementation | Evidence |
|---|---|---|
| Role-based access | `ROLE_RANK` in `packages/types` — 6 tiers (member → admin). Every API route enforces the minimum rank via `requireRole()`. | `apps/api/src/lib/auth.ts` |
| Least privilege | Members can only access their own data. Staff access is scoped to their assigned studio(s) via `assertStudioAccess` + `studio-access-plugin`. | `apps/api/src/lib/studio-access-plugin.ts` |
| Row-level security | PostgreSQL RLS enabled + FORCE on all tenant tables. Queries via `packd_api` role see only rows matching `app.current_studio_id`. | `packages/db/sql/rls_studio_isolation.sql` |
| JWT authentication | Supabase-issued JWTs verified via JWKS (`jose`). Roles read from `app_metadata` only (server-controlled — never `user_metadata`). | `apps/api/src/lib/auth.ts` |

### CC6.2 — Authentication

| Control | Implementation |
|---|---|
| Password auth | Supabase Auth (bcrypt internally). Minimum password requirements enforced by Supabase. |
| Token expiry | JWTs expire per Supabase project setting (default 1 hour). Sessions refreshed client-side. |
| Staff invite tokens | HMAC-SHA256 signed, 7-day expiry, constant-time comparison. Token verified before role is applied. |
| iCal feed tokens | HMAC-SHA256 signed per-user. Support for key rotation via `ICAL_SECRET_PREVIOUS`. |
| Session revocation | `revokeUserSessions()` called immediately when a staff role is removed — forces re-authentication. |

### CC6.3 — Access removal

Staff access is removed via `DELETE /staff/:memberId` which:
1. Updates `app_metadata.role` to `member` in Supabase Auth
2. Removes from `member.staffRoles` in the application DB
3. Calls Supabase `DELETE /auth/v1/admin/users/:id/logout` to invalidate all active sessions

Audit log entry is written for every role change.

### CC6.6 — Logical access security measures

| Control | Implementation |
|---|---|
| Rate limiting | `@fastify/rate-limit`: 200 req/min global; reduced limits on invite (20/min) and promo redeem (10/min) routes. |
| Input validation | All API routes carry Zod schemas — malformed requests return 400 before reaching handlers. |
| CORS | Origin allowlist via `CORS_ORIGIN` env var. Wildcard (`*`) rejected in production at startup. |
| HTTPS | Enforced by the hosting platform (Packd does not terminate TLS in application code). |

---

## CC7 — System Operations

### CC7.2 — Monitoring

| Control | Implementation |
|---|---|
| Error tracking | Sentry (`@sentry/node`) captures all 5xx errors with stack traces. 4xx excluded (not application bugs). |
| Ops alerting | `sendOpsAlert()` fires to `OPS_EMAIL` on: pg-boss job failures, Stripe webhook processing errors, pg-boss connectivity errors. |
| Payment failure alerts | `sendPaymentFailed()` fires to `studio.supportEmail ?? OPS_EMAIL` on `invoice.payment_failed` events. |
| Health check | `GET /health` returns `{ ok, db }` — returns 503 if DB is unreachable. Used by the platform to gate deploys. |
| Structured logging | Pino logger with JSON output in production. All requests logged with `reqId`, `statusCode`, `responseTime`. |

### CC7.3 — Incident response

See `docs/deploy-runbook.md` for the deploy/rollback procedure.

Incident steps (to be formalised):
1. Alert received via Sentry / `OPS_EMAIL`
2. Assess severity (data breach → immediate escalation; service degradation → normal on-call)
3. Rollback if recent deploy caused the issue (see deploy runbook)
4. Preserve logs before any DB changes
5. Root-cause analysis written within 48 hours of resolution
6. Post-mortem shared with affected studio admins if data was impacted

---

## CC8 — Change Management

### CC8.1 — Change control

| Control | Implementation |
|---|---|
| Version control | All code changes via Git PRs. `main` branch protected (PRs required in production setup). |
| CI gating | GitHub Actions: unit tests (205 tests) + TypeScript check on every push. E2E tests on PRs when configured. |
| OpenAPI drift detection | CI regenerates `openapi.json` and `api-types.generated.ts` and fails if committed files are stale. |
| Migration discipline | `prisma migrate deploy` only (no `db push` in production). Additive migrations required before code deploys. See `docs/deploy-runbook.md`. |

---

## CC9 — Risk Mitigation

### CC9.2 — Vendor risk

| Vendor | Purpose | Data access | Mitigations |
|---|---|---|---|
| Supabase | Auth + Postgres | Auth tokens, all application data | SOC 2 Type II certified. Data encrypted at rest and in transit. RLS isolates tenant data. |
| Stripe | Payments | Payment methods, subscription data | PCI DSS Level 1. Card data never touches Packd servers. Webhook signatures verified. |
| Resend | Transactional email | Member email addresses, booking details | No persistent storage of email content. |
| Sentry | Error tracking | Stack traces, request context (no PII by default) | Self-hosted option available. Error handler filters 4xx to reduce noise. |
| Vercel / hosting platform | API + Web hosting | All traffic | Platform-level TLS termination, DDoS protection. |

---

## PI1 — Processing Integrity

| Control | Implementation |
|---|---|
| Idempotent payments | `StripeEvent` table deduplicates webhook deliveries by Stripe event ID. |
| Atomic credit operations | All credit adjustments use Prisma transactions. Race conditions prevented with `updateMany({ where: { balance: { gte: N } } })` pattern. |
| Referral double-award prevention | Referral reward runs inside a DB transaction with count check; only fires on first booking. |
| Double-booking prevention | `checkInstructorConflict()` guards substitute assignment and session reschedule. |
| Audit log | Every financial and access-control mutation is audit-logged with `actorId`, `actorRole`, `action`, `studioId`, `createdAt`. |

---

## A1 — Availability

| Control | Implementation |
|---|---|
| Health check | `GET /health` checks DB liveness. Returns 503 on failure. |
| Background jobs | pg-boss on direct DB connection (not pgBouncer). Job failures trigger ops alerts. |
| DB connection pooling | Application queries via pgBouncer transaction pooler. pg-boss uses direct connection. |
| Zero-downtime deploys | Additive-first migration strategy. See `docs/deploy-runbook.md`. |

---

## Items requiring formal documentation

The following are not yet written and will be required for a Type II audit:

- [ ] **Access review schedule** — quarterly review of who has `studio_admin` and `franchise_admin` access
- [ ] **Log retention policy** — how long are `AuditLog` entries retained? (currently: indefinite)
- [ ] **Backup and restore tested procedure** — Supabase PITR is enabled; restore procedure untested
- [ ] **Data classification policy** — which fields are PII, sensitive, or public
- [ ] **Employee security training** — onboarding checklist for developers
- [ ] **Penetration test** — external pen test by a qualified third party (internal audit found 30 issues, all resolved)
- [ ] **Business continuity plan** — what happens if Supabase, Stripe, or Resend are unavailable
- [ ] **Privacy policy / DPA** — required for GDPR compliance (GDPR export + delete already implemented in code)
