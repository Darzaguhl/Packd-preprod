# Access Review Procedure

Packd stores elevated permissions in two places that must stay in sync:

| Store | What it holds |
|---|---|
| **DB** (`Member.staffRoles`, `Member.studioIds`) | Source of truth for which studios a user belongs to |
| **Supabase `app_metadata`** (`role`, `roles[]`, `studioIds[]`) | Embedded in JWT — what the API actually enforces at runtime |

A divergence between the two means a user's JWT may grant more (or fewer) permissions than the DB reflects — which is a security risk or an access-denial bug. This procedure finds and fixes those divergences.

---

## When to run

| Trigger | Frequency |
|---|---|
| Scheduled review | **Quarterly** (e.g. first Monday of Jan / Apr / Jul / Oct) |
| Staff offboarding | **Same day** the person leaves |
| Role change (promotion or demotion) | Within 24 h of the change |
| Suspected account compromise | Immediately |

---

## Prerequisites

You need three environment variables:

| Variable | Where to find it |
|---|---|
| `DATABASE_URL` | `apps/api/.env` — direct (non-pooled) Postgres connection string |
| `SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → `service_role` key |

Never commit these values. Run the script from your local machine or a secured CI runner.

---

## How to run

### Table output (interactive review)

```bash
DATABASE_URL="postgresql://..." \
SUPABASE_URL="https://xxx.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  npm run access-review
```

### CSV output (save for records / email to approver)

```bash
DATABASE_URL="..." SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
  npm run access-review -- --format=csv > access-review-$(date +%Y-%m-%d).csv
```

### Exit codes

| Code | Meaning |
|---|---|
| `0` | No mismatches — review complete |
| `1` | One or more mismatches detected — action required |
| `2` | Script error (bad credentials, DB unreachable, etc.) |

---

## Reading the output

The table has one row per staff member (anyone with a non-empty `staffRoles` in the DB). Columns:

| Column | Description |
|---|---|
| **Name** | First + last name from `User` |
| **Email** | Supabase auth email |
| **DB Roles** | `Member.staffRoles` array |
| **Studios** | Number of studios from `Member.studioIds` (or 1 from `studioId`) |
| **Last Active** | Last sign-in from Supabase Auth, or `User.updatedAt` if never signed in |
| **Mismatch** | `YES` if DB and Supabase metadata disagree |
| **Detail** | Human-readable description of the mismatch |

The summary section shows totals by role and by studio, plus a count of mismatches.

---

## What to look for

### Mismatches (Mismatch = YES)

The script flags four categories:

1. **DB roles present, metadata empty** — the user has DB roles but no Supabase `app_metadata.role`. Their JWT will grant `member` rank at runtime even though the DB says otherwise. Requires a metadata write.

2. **Primary role differs** — e.g. DB primary is `studio_admin` but metadata says `instructor`. The API enforces the JWT role. Whichever is wrong must be corrected.

3. **roles[] array out of sync** — a role present in one store but not the other. Particularly important for dual-role users (`instructor` + `fronthost`).

4. **studioIds[] divergence** — the user's studio access list differs between DB and metadata. Could mean over-provisioned access (metadata has more studios) or under-provisioned (DB has more).

5. **User not in Supabase Auth** — the DB has a `Member` record but no matching Supabase user. This is an orphaned record and should be investigated.

### Stale access

Even without a mismatch, review the **Last Active** column:

- A user who hasn't signed in for **90+ days** and still holds elevated roles should be reviewed with their manager.
- A former employee who never had access revoked will appear here.

### Unexpected elevated roles

Review every `studio_admin`, `franchise_admin`, `brand_admin`, and `admin` entry. Confirm each person still requires that level of access. `instructor` and `fronthost` entries need spot-checking — pay attention to users with roles across many studios.

---

## How to remove access

### Remove a specific studio from a staff member

```bash
# 1. Remove from DB staffRoles + studioIds via the API:
curl -X DELETE https://api.yourpackd.com/staff/<memberId>/studios/<studioId> \
  -H "Authorization: Bearer <studio_admin_token>"

# 2. For complete role removal, use the staff endpoint:
curl -X DELETE https://api.yourpackd.com/staff/<memberId>/roles/<role> \
  -H "Authorization: Bearer <studio_admin_token>"
```

### Remove all access (offboarding)

```bash
# Update app_metadata to member-only
curl -X PUT https://<SUPABASE_URL>/auth/v1/admin/users/<userId> \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"app_metadata": {"role": "member", "roles": [], "studioIds": []}}'

# Revoke active sessions immediately
curl -X DELETE https://<SUPABASE_URL>/auth/v1/admin/users/<userId>/logout \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "apikey: <SERVICE_ROLE_KEY>"
```

Then update the DB record:

```sql
UPDATE "Member"
SET "staffRoles" = '{}', "studioIds" = '{}'
WHERE "userId" = '<userId>';
```

Or use the Prisma-backed admin API if available.

> **Note:** Revoking sessions invalidates the user's current JWT immediately. Without that step, their existing token (valid for ~1 hour) retains the old role. Always revoke sessions for security-sensitive removals.

---

## Sign-off requirement

| Review type | Who runs | Who approves |
|---|---|---|
| Quarterly | Engineering lead or designated ops | Franchise admin / company officer |
| Offboarding | Engineering on-call | Manager of the departing employee |
| Incident-driven | Security lead | Two approvers required |

The output CSV (or a screenshot of the table output) must be:

1. Saved to the shared drive folder: **`Security / Access Reviews / Packd`**
2. Named: `access-review-YYYY-MM-DD.csv`
3. Signed off by the approver in the linked ticket or email thread

If mismatches are found, a remediation ticket must be opened and resolved within **5 business days** (or immediately for offboarding cases).

---

## Automation (optional)

To run this on a schedule via CI, add to `.github/workflows/access-review.yml`:

```yaml
name: Quarterly Access Review
on:
  schedule:
    - cron: '0 8 1 1,4,7,10 *'   # 08:00 UTC on the 1st of Jan/Apr/Jul/Oct
  workflow_dispatch:               # allow manual trigger

jobs:
  access-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm
      - run: npm ci
      - name: Run access review
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
        run: npm run access-review -- --format=csv > access-review.csv
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: access-review-${{ github.run_id }}
          path: access-review.csv
          retention-days: 365
```

> The job exits with code `1` when mismatches are detected, which will fail the workflow and trigger a GitHub notification.
