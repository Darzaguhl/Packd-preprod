# Packd Deploy Runbook

Zero-downtime deploy strategy for the Packd API + Web monorepo.

---

## Principles

1. **Migrations before code** — DB schema must be backward-compatible with the *previous* API version before the new API version is deployed. The old API must be able to run against the new schema without errors.
2. **Expand/contract for breaking changes** — never drop a column or change a type in the same deploy that starts using the new shape.
3. **Health check gates deploys** — the platform must confirm `/health` returns 200 with `"db":"ok"` before routing traffic.
4. **pg-boss uses a direct DB connection** — never point `PGBOSS_DATABASE_URL` at the pgBouncer pooler. Advisory locks + `LISTEN/NOTIFY` break with transaction-mode pooling.

---

## Standard deploy (non-breaking schema change or code-only)

```
1. Run: npm run db:migrate:deploy        # applies pending migrations
2. Deploy API (rolling restart)          # platform handles this
3. Deploy Web                            # Next.js, independent
```

`db:migrate:deploy` runs `prisma migrate deploy` — non-interactive, applies all pending migrations in order. It uses `DATABASE_URL` for queries and `DIRECT_URL` for the migration itself (bypasses pgBouncer).

**The migration must be additive-only**: new nullable columns, new tables, new indexes. The running API must still work after the migration is applied.

---

## Breaking schema change — expand/contract (3-phase deploy)

Use this when you need to rename a column, change a type, or drop something.

### Phase 1 — Expand (backward-compatible addition)

Write a migration that **adds** the new shape alongside the old:

```sql
-- Example: rename "memberNote" to "bookingNote" on Booking
ALTER TABLE "Booking" ADD COLUMN "bookingNote" TEXT;
-- Copy existing data
UPDATE "Booking" SET "bookingNote" = "memberNote" WHERE "memberNote" IS NOT NULL;
```

Deploy Phase 1 migration. Old API still reads/writes `memberNote`. New column exists but unused.

### Phase 2 — Migrate code

Update application code to read from **both** columns (fallback logic) and write to the **new** column:

```ts
// Read: prefer new, fall back to old during transition
const note = booking.bookingNote ?? booking.memberNote

// Write: always use new column
data: { bookingNote: note }
```

Deploy the code. Both old and new column are populated. Any rollback is safe — old column still has data.

### Phase 3 — Contract (remove old shape)

Once Phase 2 has been running stably (at least one full deploy cycle with no rollbacks):

```sql
ALTER TABLE "Booking" DROP COLUMN "memberNote";
```

Remove the fallback read logic from the code. Deploy.

---

## Rollback procedure

```
1. Deploy the previous API image/tag
2. DO NOT run migrations in reverse — Prisma does not support down migrations
3. If the current migration is additive (columns/tables added):
   - Previous API works fine — new nullable columns are ignored
4. If a Phase 3 (column drop) was deployed and needs rollback:
   - Restore from DB backup (point-in-time recovery)
   - This is why Phase 3 must only happen after Phase 2 is confirmed stable
```

---

## Pre-deploy checklist

- [ ] `npm test` passes (197/197)
- [ ] `npm run typecheck` passes (0 errors)
- [ ] New migration reviewed: is it additive? Does the old API work against the new schema?
- [ ] `prisma migrate status` shows all migrations applied on staging
- [ ] Health endpoint reachable: `curl https://api.yourdomain.com/health` → `{"status":"ok","db":"ok"}`
- [ ] Stripe webhook endpoint registered for the new domain (if changing)
- [ ] `OPS_EMAIL` is set — deploy failures trigger ops alerts

---

## Environment variables required in production

See `apps/api/.env.example` for the full documented list. Critical ones:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | pgBouncer pooler URL (port 6543, `?pgbouncer=true`) |
| `DIRECT_URL` | Direct Postgres URL (port 5432) — used by Prisma migrations |
| `PGBOSS_DATABASE_URL` | Direct Postgres URL (port 5432, **not** the pooler) |
| `SUPABASE_URL` | Required at startup — server refuses to start without it |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin API access |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Payments |
| `RESEND_API_KEY` / `EMAIL_FROM` | Email delivery |
| `ICAL_SECRET` | iCal feed HMAC signing |
| `INVITE_SECRET` | Staff invite HMAC signing (falls back to ICAL_SECRET) |
| `CORS_ORIGIN` | Must not contain `*` in production |
| `OPS_EMAIL` | Receives job failure and webhook error alerts |
| `SENTRY_DSN` | Optional but recommended for error tracking |

---

## Platform-specific notes

### Railway / Render / Fly.io
These platforms support rolling restarts with health check polling. Configure:
- **Health check path**: `GET /health`
- **Health check timeout**: 30s (allows pg-boss startup)
- **Min healthy instances**: 1 (so traffic is only cut over after the new instance passes)
- **Release command** (Railway/Render): `npm run db:migrate:deploy`
  - This runs migrations before the new instance receives traffic

### Docker / VPS
Blue-green deploy:
1. Start new container (same DB, new image)
2. Wait for `GET /health` → 200 on new container
3. Switch load balancer to new container
4. Run `npm run db:migrate:deploy` against new container
5. Stop old container

---

## Monitoring

After every deploy, verify:

```bash
# API health
curl https://api.yourdomain.com/health

# Check Sentry for new error spikes (compare last-1h vs previous-1h)
# Check OPS_EMAIL inbox for any job failure alerts within 5 minutes of deploy
```

If you see a spike in 5xx errors within 2 minutes of deploy → rollback immediately.
