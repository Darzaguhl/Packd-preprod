# Database migrations

## Workflow

### Making a schema change (local)

1. Edit `prisma/schema.prisma`
2. `npm run db:migrate` — Prisma creates a migration file and applies it to your local DB
3. Name the migration descriptively when prompted (e.g. `add_member_notes`)
4. Commit the generated `prisma/migrations/<timestamp>_<name>/migration.sql` file

### Applying migrations to production / staging

```bash
npm run db:migrate:deploy
```

This runs `prisma migrate deploy` — applies all pending migration files in order,
non-interactively. Safe to run in CI/CD. Never prompts or resets data.

### History

The `prisma/migrations/` directory is the single source of truth for all schema
changes. Each migration file is append-only and should never be edited after it has
been applied to any environment.

`0_baseline` was created from the existing schema on 2026-05-30 and marked as applied
on the preprod Supabase DB, establishing the migration baseline.

## Rules

- **Never** use `prisma db push` against the preprod or production DB — it bypasses
  migration history and can cause drift.
- **Always** commit migration files — they are production artefacts, not local state.
- **Never** edit a migration file after it has been applied anywhere.
