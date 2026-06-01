# AuditLog Retention Policy

## Retention period

AuditLog entries are kept for **365 days** (1 year) and then hard-deleted. No archival copy is made.

## Enforcement

Deletion runs inside the **`nightly.maintenance`** pg-boss job, which is scheduled at `0 2 * * *` (02:00 UTC daily).

The relevant code lives at the end of the `nightly.maintenance` worker in `apps/api/src/jobs/index.ts`:

```ts
const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
const deleted = await prisma.auditLog.deleteMany({
  where: { createdAt: { lt: oneYearAgo } },
})
if (deleted.count > 0) {
  logger.info({ count: deleted.count }, '[nightly] AuditLog retention: deleted old entries')
}
```

## Database index

The `AuditLog` model has `@@index([studioId, createdAt])` in `packages/db/prisma/schema.prisma`. This composite index is used by the audit-log read queries (filtered by studio) and also satisfies the range scan on `createdAt` used by the retention delete.

## Monitoring

- Deletion count is logged at **INFO** level with the key `[nightly] AuditLog retention: deleted old entries`.
- If `deleted.count > 1000` on a single run, this may indicate a backlog (e.g. first run after deploying this policy). Review the run in application logs and confirm the count is declining over subsequent nights.
- Job-level failures surface through the `wrapWorker` alert mechanism: any unhandled throw in `nightly.maintenance` triggers an ops alert email via `sendOpsAlert`.

## Changing the retention period

1. Update the `365` constant in `apps/api/src/jobs/index.ts`.
2. Redeploy the API.
3. Update this document to reflect the new period.

No migration or schema change is required — retention is enforced at the application layer.

## Scope

Only rows in the `AuditLog` table are affected. All other tables (e.g. `CreditTransaction`, `Booking`, `ProductSale`) are **not** subject to this policy and are retained indefinitely unless explicitly deleted.
