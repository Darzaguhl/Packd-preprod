# Packd — Claude Context

Boutique fitness studio management platform (think Zingfit / Mariana Tek). Full-stack monorepo.

## Stack

| Layer | Tech |
|---|---|
| Monorepo | Turborepo + npm workspaces |
| Web | Next.js 15 (App Router), React 19, Tailwind CSS v4 |
| API | Fastify 5, Zod, Jose (JWKS JWT) |
| DB | Prisma 6 + Supabase Postgres |
| Auth | Supabase Auth (publishable key format) |
| Jobs | pg-boss v10 (no Redis) |
| Payments | Stripe |
| Email | Resend |
| Error tracking | Sentry (`@sentry/node`) |
| DnD | @dnd-kit/core + @dnd-kit/sortable |
| Tests | Vitest 3 (unit) + Playwright 1.60 (E2E) |
| CI | GitHub Actions (unit tests + typecheck on every push; E2E on PRs when secrets configured) |

## Ports

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

## Running the project

```bash
npm install              # also runs prisma generate via postinstall

cd apps/api && npm run dev           # API on :4000
cd apps/web && npm run dev           # Web on :3000

npm test                             # Vitest unit tests (149 passing across 17 files)
npm run test:e2e                     # Playwright (needs both servers + .auth/ state files)

npm run db:migrate                   # create + apply migration locally (interactive)
npm run db:migrate:deploy            # apply pending migrations non-interactively (CI/prod)
```

## Key environment files

**`apps/api/.env`** — `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN=http://localhost:3000`, `PORT=4000`, `WEB_URL=http://localhost:3000`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ICAL_SECRET`, `SENTRY_DSN` (optional), `OPS_EMAIL` (fallback alert address when studio has no supportEmail)

**`apps/web/.env.local`** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (sb_publishable_... format), `NEXT_PUBLIC_API_URL=http://localhost:4000`, `NEXT_PUBLIC_STUDIO_ID`

See `apps/api/.env.example` for full documented list.

## Architecture gotchas

### Auth
- Supabase publishable key format (`sb_publishable_...`), not legacy anon key
- JWT via JWKS (`jose`) — **no issuer check** (Supabase issuer has `/auth/v1` suffix)
- Role read from `app_metadata` only — never `user_metadata`
- Set role: `PUT /auth/v1/admin/users/:userId` `{"app_metadata":{"role":"studio_admin"}}` with service role key
- `assertStudioAccess` is defined **once** in `routes/admin-shared.ts` and imported everywhere — do not add local copies

### Next.js 15 + Supabase SSR
- Server Components can't set cookies — `setAll` in `supabase/server.ts` is wrapped in `try/catch`
- Token fetching for API calls must be client-side in `useEffect`

### Prisma 6
- `PrismaClientKnownRequestError` is imported from `@prisma/client/runtime/library.js`, not from the `Prisma` namespace
- `Prisma.BrandGetPayload` / `Prisma.XxxGetPayload` do not exist in Prisma 6 — use `Awaited<ReturnType<typeof prisma.xxx.findFirst<{include:{...}}>>>` instead
- `Prisma.InputJsonValue` is not exported from the namespace — use `as unknown as object` for JSON field casts
- `noImplicitAny: false` is set in `apps/api/tsconfig.json` — Prisma's complex transaction callback types can't be inferred in strict mode

### pg-boss v10
- `boss.createQueue(name)` before scheduling — queues are not auto-created
- Create queues **sequentially** (for…of), not `Promise.all` — parallel DDL deadlocks

### Vitest + Fastify 5
- preHandler mocks: `vi.fn().mockResolvedValue(undefined)` — synchronous `undefined` stalls the lifecycle
- Prisma `$transaction` mock: share the same model `vi.fn()` instances in both the `prisma` export and the `$transaction` proxy
- `$transaction` callback form: `vi.fn(async (fn) => fn(tx))`; array form: `vi.fn(async (arr) => Promise.all(arr))`
- Custom errors use `{ statusCode: N }` not `{ code: 'NAME' }`
- When mocking `@packd/db`, always include `auditLog: { create: vi.fn().mockResolvedValue({}) }` — audit() is called in many routes
- When mocking routes that touch Stripe sync, also mock `../lib/stripe-sync.js`

### Stripe
- Webhook signature verification requires raw body — registered via `addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)` in `server.ts`
- `StripeEvent` table provides idempotency — duplicate webhook deliveries are deduplicated on `id`
- Replay endpoint: `POST /stripe/replay/:eventId` (studio_admin+) — deletes idempotency record and re-injects

### Tailwind CSS v4
- `@import "tailwindcss"` in `globals.css`; `postcss.config.js` with `@tailwindcss/postcss`; no `tailwind.config.js` needed

### React
- Root `package.json` overrides pin React 19 — do not remove (Expo conflict)
- Platform-specific rollup/esbuild binaries are in `optionalDependencies` — npm picks the right one per platform automatically

## Database schema

```
Studio → Location → Room → RoomLayout → Station
Studio → Instructor
Studio → ClassTemplate → ClassSession → Booking → Member
                      ↗ ClassSchedule (recurring)   ↘ WaitlistEntry
Member → CreditBalance + CreditTransaction
Member → MembershipSubscription → MembershipPlan
Member → GuestPass
Studio → CancellationPolicy
Studio → Product → ProductSale
Studio → StudioIntegration
Studio → PromoCode → PromoCodeRedemption
Studio → StudioNetwork → StudioNetworkMembership
Member → StaffShift                # individual shift instance (one-off or generated)
Studio → StaffShiftPattern → StaffShift  # recurring shift pattern
AuditLog                           # staff action log
StripeEvent                        # webhook idempotency
MemberNote                         # staff notes on members
```

Key fields:
- `ClassSchedule`: `daysOfWeek Int[]`, `startTime`, `durationMin`, `intervalWeeks @default(1)`, `validFrom/validUntil`, `isActive`
- `ClassSession`: `scheduleId` (nullable → SetNull), `substituteInstructorId`
- `RoomLayout`: `widthM`, `lengthM`, `isActive`
- `Station`: `type: StationType`, `xM`, `yM`, `rotation`, `label`
- `Booking.stationId` — spot assignment
- `Member.staffRoles String[] @default([])` — all roles; `studioIds` in `app_metadata` for multi-studio
- `Member.guestPassBalance` — current guest pass balance
- `Member.payRateHourlyCents Int?` — hourly pay rate for shift-based staff (fronthosts)
- `StaffShift`: `memberId`, `studioId`, `startsAt`, `endsAt`, `note`, `patternId` (null = one-off)
- `StaffShiftPattern`: `daysOfWeek Int[]`, `startTime`, `endTime`, `intervalWeeks @default(1)`, `validFrom`, `validUntil?`, `note` — generates StaffShift instances 12 weeks out on create/update
- `Product`: `category @default("Other")`, `priceInCents`, `creditsRequired Int @default(0)`, `inStock`; free = both price and credits = 0
- `AuditLog`: `actorId`, `actorRole`, `action`, `targetId`, `meta Json`, `studioId`, `createdAt`
- `GuestPass`: signed `amount` (positive = grant, negative = use), `guestName` on use entries

Seed (`packages/db/src/seed.ts`): 1 studio (Packd Demo), Stockholm City location, 2 rooms (Ride Room cap 20, The Floor cap 16), 3 templates, 1 instructor (Alex Rivera), 3 plans, ~26 sessions.

## Security model

- **Roles**: `admin=5`, `franchise_admin=4`, `studio_admin=3`, `instructor=2`, `fronthost=2`, `member=1`
- `fronthost` and `instructor` share rank 2 — both pass `requireRole('instructor')` but not `requireRole('studio_admin')`
- **Dual-role**: `app_metadata.roles[]` for all roles, `app_metadata.role` for primary. `DualRoleDashboard` renders for users with both `fronthost` + `instructor`.
- **Multi-studio**: `app_metadata.studioIds[]` — `assertStudioAccess` (in `routes/admin-shared.ts`) checks JWT `studioIds` first (fast path), then DB `member.studioId` + `member.studioIds` (fallback). Single authoritative copy — imported by admin-sessions, admin-members, admin-analytics, admin-exports, admin-sales, studios, franchise, integrations.
- **Booking guards**: past-class booking blocked for members (400); privileged roles (rank ≥ fronthost) bypass. LATE_CANCELLED re-books via `update` not `create` (avoids P2002). Cancel clears `stationId`.
- **Instructor permissions** (JSON on `Instructor`): `canCheckInMembers`, `canManageWaitlist` (true), `canManageBookings`, `canViewMemberContact`, `canEditSessionDetails`, `canCancelSession`, `canCreateSchedules` (all false default).
- `StudioManagerDashboard`: reads role from `session.user.app_metadata.role` as `sessionRole` fallback; `effectiveRole = role ?? sessionRole`.
- **Audit log**: `audit()` helper in `lib/audit.ts` — fire-and-forget, never throws. `studioId` is required in every call so the query (which filters by studioId) finds entries. Wired into: credit adjust, note delete, subscription pause/resume, guest pass grant, refund, stripe replay, schedule create/delete, session cancel/reschedule/checkin, bulk ops, booking cancel by admin, shift create/update/delete, shift pattern create/delete, staff role add/remove, staff pay update.

## File map

```
apps/
  api/src/
    server.ts              # Fastify setup, CORS, rate limiting, Sentry, swagger
    lib/
      auth.ts              # requireAuth, JWKS, role helpers
      audit.ts             # AuditLog write helper (fire-and-forget)
      email.ts             # Resend senders: welcome, confirmation, cancellation,
                           # reminder, waitlist promotion, staff invite, payment failed
      logger.ts            # pino logger instance
      stripe-sync.ts       # Stripe product/price create/update/archive
      studio-ctx.ts        # withStudioCtx() — RLS context helper
      supabase-admin.ts    # Supabase admin API helpers
    jobs/index.ts          # pg-boss handlers (no-show fee, late cancel, reminders)
    routes/
      admin.ts             # thin barrel — registers 5 sub-plugins
      admin-shared.ts      # assertStudioAccess + validateSelectQuery (single source)
      admin-sessions.ts    # session list, bookings view, check-in, bulk cancel/sub
      admin-members.ts     # member CRUD, credits, notes, subscriptions, guest passes,
                           # purchases, audit-log read
      admin-analytics.ts   # stats, leaderboard, analytics (capped at 2000 sessions)
      admin-sales.ts       # product sales, guest check-in
      admin-exports.ts     # CSV exports + custom SELECT query (10/min rate limit)
      availability.ts      # instructor availability blocks
      bookings.ts          # member booking create/cancel/checkin
      brands.ts            # brand management (franchise_admin+)
      franchise.ts         # franchise/studio management, instructor/fronthost permissions
      ical.ts              # iCal feeds: /member/:id/:token, /instructor/:id/:token, /fronthost/:id/:token
      integrations.ts      # Mariana Tek integration config + member/session sync
      memberships.ts       # membership plans + subscriptions
      members.ts           # member profile, me, stats, POST /ensure
      networks.ts          # studio networks (cross-location booking)
      products.ts          # product CRUD + Stripe sync
      promos.ts            # promo codes
      rooms.ts             # room + layout + station management
      schedule.ts          # member-facing schedule
      schedules.ts         # class schedule (recurring) management + month view
      shifts.ts            # staff shift CRUD (GET/mine, POST, PATCH, DELETE) at /admin/shifts
      shift-patterns.ts    # recurring shift patterns (GET, POST, PATCH, DELETE) at /admin/shift-patterns
                           # POST generates StaffShift instances 12w out; PATCH drops future + regenerates
      staff.ts             # staff invite, role management, hourly pay rate (PATCH /:id/hourly-pay)
      stripe.ts            # checkout, webhook, refund, replay, customer portal
      studios.ts           # studio settings
      waitlist.ts          # waitlist join/leave/promote
      webhooks.ts          # Mariana Tek inbound webhooks
    __tests__/             # 143 Vitest unit tests across 16 files
  web/src/
    app/                   # Next.js pages (login, onboarding, schedule, dashboard, account)
    components/
      ScheduleView.tsx     # Member schedule shell + location picker
      AccountView.tsx      # Member account page (credits, bookings, plans, purchases)
      schedule/            # ClassCard, SessionDetailView, DayTabs, FilterBar, CapacityBar
      admin/               # AdminShell (mgmt/front-desk toggle), SessionPanel
      calendar/            # CalendarView (week/month/schedules), ScheduleModal, SubstituteModal
      franchise/           # FranchiseDashboard
      studio/              # StudioManagerDashboard, RoomsTab, PermissionsTab,
                           # SettingsTab (3-tab: general/policies/features), StaffTab,
                           # ProductsTab, AnalyticsTab, QueryTab, AuditLogTab, BulkOpsPanel
      room/                # RoomMapView, RoomMapEditor, SessionRoomMap (S/M/L/XL font), SpotPicker
      fronthost/           # FronthostDashboard, MemberDrawer, CreditModal
      member/              # MemberHistoryView, MemberProfilePage
      dual/                # DualRoleDashboard
      onboarding/          # OnboardingFlow (studio setup wizard — admin first-time only)
    lib/
      api.ts               # Typed API client
      supabase/            # client.ts + server.ts
      audit.ts             # (frontend) audit log display helpers
    middleware.ts          # Session refresh
packages/
  db/prisma/schema.prisma
  db/src/seed.ts
  types/src/index.ts       # Shared types
e2e/
  global-setup.ts          # Creates test users in Supabase, seeds credits, saves auth state
  fixtures.ts              # authedPage + adminPage fixtures (load .auth/ saved state)
  auth.spec.ts             # Auth flow tests
  booking.spec.ts          # Book → verify booked → cancel → verify unbooked
  schedule.spec.ts         # Schedule structure tests
  frontdesk.spec.ts        # Admin dashboard, member search, check-in
  performance.spec.ts      # LCP, CLS, API latency benchmarks
.github/workflows/ci.yml   # Unit tests + typecheck on every push; E2E on PRs (disabled
                           # until GitHub secrets configured)
```

## Key patterns

- `studioId` for admin views: use `profile.studioId` (from member record, always set) not `app_metadata.studioId` (often absent for admins)
- `isFree(product)`: check BOTH `priceInCents === 0 && creditsRequired === 0` — 0 credits alone is not free
- On-behalf booking: rank check `ROLE_RANK[user.role] >= ROLE_RANK['fronthost']`; members always book for themselves
- Atomic balance guard: `updateMany({ where: { id, balance: { gte: 1 } } })` + check `count === 0` — prevents race conditions
- Lazy SDK init: `let _client = null; function get() { return _client ?? (_client = new SDK(key)) }` — applies to Stripe, Resend
- CSV export: `Content-Type: text/csv` + `Content-Disposition: attachment`; frontend uses Blob + `URL.createObjectURL` + `<a>.click()`
- Guest passes follow CreditTransaction pattern: signed `amount`, `guestName` on use entries
- `vi.mock` factory hoisting: define `vi.fn()` instances INSIDE the factory, access via `vi.mocked()` after import
- **audit() studioId**: always pass `studioId` — the audit-log query filters by it, so entries without it are invisible in the UI
- **Shift pattern generation**: `generateOccurrences()` in `shift-patterns.ts` anchors the week-interval to the Monday of `validFrom`; uses `weeksSinceStart % intervalWeeks === 0` check. PATCH drops future shifts and regenerates; past shifts are untouched.
- **iCal token endpoint** (`GET /ical/token`): checks `prisma.instructor.findFirst` (→ `urls.instructor`) and `prisma.member.findFirst` with `staffRoles.has('fronthost')` (→ `urls.fronthost`). Tests must mock both.
- **StaffTab ShiftsSection**: only loads one-off shifts (those without `patternId`) in the one-off list; patterns are fetched separately via `GET /admin/shift-patterns?memberId=`. Uses `api.shifts.list` (admin endpoint), not `api.shifts.mine`, because the viewer is always an admin.

## Security and architecture review protocol

When asked to do a security review, architectural review, or audit:

**Step 1 — Search before reading**
Run these before opening any file:
```bash
grep -rn "async function" apps/api/src/routes/ | grep -v "//\|import"  # find duplicated helpers
grep -rn "catch.*{}" apps/api/src/                                      # find swallowed exceptions
grep -rn "\.catch(() => {})" apps/api/src/                              # find silent fire-and-forget
grep -rn "process\.env\." apps/api/src/ | grep -v "\.env\."            # find unvalidated env usage
```

**Step 2 — Cover every route file systematically**
For each file in `apps/api/src/routes/`, check:
- [ ] Auth check exists (`requireAuth` / `requireRole`)
- [ ] Role check uses `ROLE_RANK` comparison, not string equality (`=== 'admin'`)
- [ ] `studioId` access check present (`assertStudioAccess` or equivalent)
- [ ] Input validated before use
- [ ] Rate limiting on expensive or destructive operations
- [ ] Idempotency on payment/financial mutations
- [ ] Response doesn't leak fields above the caller's role

**Step 3 — Check cross-file patterns**
- [ ] Is any security-critical function defined more than once? (`assertStudioAccess`, `validateSelectQuery`, etc.)
- [ ] Does a fix in one file also need to happen in others?
- [ ] Are library API contracts verified against the installed version, not assumed?

**Step 4 — Check what fails silently**
- [ ] Every `.catch(() => {})` — is silence acceptable, or should it alert?
- [ ] Every webhook handler — if the DB write succeeds but the email fails, is that acceptable?
- [ ] Every payment flow — if it fails at step N, are credits/money in a consistent state?

**Step 5 — Check test coverage on critical paths**
- [ ] Is every payment webhook event covered by a test?
- [ ] Is every auth bypass scenario covered by a test?
- [ ] Do tests verify failure cases, not just the happy path?

**Do not report findings from memory. Verify every claim with a grep or file read before stating it.**

## Backlog

### Remaining
- [ ] E2E tests in CI — all specs written; CI job exists but disabled (`if: false`). Needs 5 GitHub secrets configured in the repo: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `STUDIO_ID`. Once set, remove `if: false` from `.github/workflows/ci.yml`.

## Completed features

### Infrastructure
- Database migration history — `packages/db/prisma/migrations/0_baseline/` establishes the baseline; use `npm run db:migrate` (interactive) or `npm run db:migrate:deploy` (CI) going forward instead of `db push`
- Analytics DB-side aggregation — `admin-analytics.ts` runs all heavy aggregations as raw `GROUP BY` SQL queries; only instructor loyalty rate (requires time-ordered sequential processing) runs in JS on a minimal dataset
- Waitlist promotion email — `sendWaitlistPromotion` called in `bookings.ts` when a cancellation triggers a waitlist promotion; sends branded Resend email with booking details
- Stripe credit purchase flow — `MembershipsTab` has "Sync" button per plan that calls `stripe-sync.ts` to create/update a Stripe product+price and store `stripePriceId`; plans show green "Stripe" badge when synced or amber "Not synced" warning; `POST /stripe/checkout` uses the `stripePriceId` for subscription checkout
- RLS Option B — `packages/db/sql/rls_studio_isolation.sql` enables RLS on all tenant tables; `apps/api/src/lib/studio-ctx.ts` provides `withStudioCtx(studioId, fn)` which runs `SET LOCAL ROLE packd_api` + `set_config('app.current_studio_id', ...)` inside a transaction so policies are enforced
- Expo mobile app — `apps/mobile/` with Expo Router; login (`app/(auth)/login.tsx`), schedule (`app/(tabs)/schedule.tsx`), account (`app/(tabs)/account.tsx`) screens; auth via Supabase, API calls via `src/lib/api.ts`

### Staff scheduling (2026-05-30)
- Staff shift scheduling — `StaffShift` + `StaffShiftPattern` models; one-off and recurring (every 1–4 weeks) shifts; full CRUD API at `/admin/shifts` and `/admin/shift-patterns`; StaffTab drawer has Shifts section with add/edit/delete for both; shift blocks visualised in CalendarView week view (colour-coded per fronthost, filter strip, click to edit)
- Recurring shifts — `intervalWeeks` field; "Repeat every 1/2/3/4 weeks" segmented control in modal; generation anchored to `validFrom` Monday; PATCH drops future instances and regenerates
- Hourly pay rate — `Member.payRateHourlyCents`; `PATCH /staff/:memberId/hourly-pay`; shown and editable in StaffTab drawer; estimated pay displayed per shift and per pattern
- iCal feeds — instructor feed (`/ical/instructor/:id/:token`) and fronthost shift feed (`/ical/fronthost/:id/:token`); `/ical/token` returns `urls.instructor` / `urls.fronthost` based on DB role lookup; AccountView shows subscribe cards for each feed

### Audit log (2026-05-30)
- Audit log coverage — fixed `studioId = null` bug (entries were invisible in queries); added `audit()` calls to: schedule create/delete, session cancel/reschedule/checkin, bulk ops, booking cancel by admin, shift CRUD, shift pattern CRUD, staff role add/remove, staff pay update
- Audit log UI — `AuditLogTab` wired into StudioManagerDashboard under "Audit Log" tab

### E2E tests (2026-05-30)
- `shifts.spec.ts` — add/edit/delete one-off shift; add/delete recurring pattern; verify audit log entry after shift actions
- `account.spec.ts` — account page loads, iCal member card visible, upcoming section present
- `global-setup.ts` — seeds fronthost role on `e2e-member` so shift tests have a target; `data-testid` attributes added to StaffTab, AuditLogTab, AccountView

### UX polish (2026-05-30)
- Bulk ops toggle moved into CalendarView toolbar (alongside "+ New schedule") — removes the standalone strip below the header
- Live view name size — SessionRoomMap now has S / M / L / **XL** (18 px) option, persisted to localStorage

### Session announcements + payroll export (2026-05-30)
- Session announcements — `POST /admin/sessions/:id/announce` (studio_admin+, rate-limited 5/min); emails all confirmed attendees via Resend with admin-supplied subject + message; inline compose form in `SessionPanel` (blue "Announce" button → subject + textarea + send); audit-logged
- Staff pay export — `GET /admin/export/staff-pay` combines instructor per-head earnings + fronthost shift-hours earnings in one CSV; "Staff Pay" download button added to AnalyticsTab alongside existing exports; `sendSessionAnnouncement` email template added to `email.ts`
- 6 new unit tests across `announce.test.ts` and `exports.test.ts` (149 total, 17 files)
