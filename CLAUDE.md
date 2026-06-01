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

npm test                             # Vitest unit tests (205 passing | 7 skipped across 23 files)
npm run test:e2e                     # Playwright (needs both servers + .auth/ state files)

npm run db:migrate                   # create + apply migration locally (interactive)
npm run db:migrate:deploy            # apply pending migrations non-interactively (CI/prod)
```

## Key environment files

**`apps/api/.env`** — `DATABASE_URL`, `PGBOSS_DATABASE_URL` (direct connection, no pgBouncer; falls back to `DATABASE_URL` via `||`), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN=http://localhost:3000`, `PORT=4000`, `WEB_URL=http://localhost:3000`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ICAL_SECRET`, `INVITE_SECRET` (falls back to `ICAL_SECRET`; signs staff invite tokens), `SENTRY_DSN` (optional), `OPS_EMAIL` (fallback alert address when studio has no supportEmail)

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
Brand → Franchise → Studio → Location → Room → RoomLayout → Station
                  → Instructor
                  → ClassTemplate → ClassSession → Booking → Member
                                 ↗ ClassSchedule (recurring)   ↘ WaitlistEntry
Member → CreditBalance + CreditTransaction
Member → MembershipSubscription → MembershipPlan
Member → GuestPass
Member → Referral (referrer/referee)
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
- `Booking.stationId` — spot assignment; `Booking.memberNote String?` — optional note from member at booking time
- `Member.staffRoles String[] @default([])` — all roles; `studioIds` in `app_metadata` for multi-studio
- `Member.guestPassBalance` — current guest pass balance
- `Member.payRateHourlyCents Int?` — hourly pay rate for shift-based staff (fronthosts)
- `Member.emailPreferences Json @default("{}")` — `{ classReminder, marketing, waitlist }` all default true; checked before sending emails
- `Member.lastWinbackAt DateTime?` — last win-back email; prevents re-sending within 60 days
- `Member.referralCode String? @unique` — auto-generated 6-char code; get/generate via `GET /members/me/referral`
- `StaffShift`: `memberId`, `studioId`, `startsAt`, `endsAt`, `note`, `patternId` (null = one-off)
- `StaffShiftPattern`: `daysOfWeek Int[]`, `startTime`, `endTime`, `intervalWeeks @default(1)`, `validFrom`, `validUntil?`, `note` — generates StaffShift instances 12 weeks out on create/update
- `Product`: `category @default("Other")`, `priceInCents`, `creditsRequired Int @default(0)`, `inStock`; free = both price and credits = 0
- `ProductSale.stripeReceiptUrl String?` — captured from PaymentIntent in `checkout.session.completed` webhook
- `AuditLog`: `actorId`, `actorRole`, `action`, `targetId`, `meta Json`, `studioId`, `createdAt`
- `GuestPass`: signed `amount` (positive = grant, negative = use), `guestName` on use entries
- `Studio.taxRatePct Float @default(0)` — VAT/tax %; `stripeTaxRateId String?` caches Stripe TaxRate ID
- `Studio.allowMemberPause Boolean @default(false)` — controls whether members can self-pause subscriptions (opt-in)
- `Studio.referralRewardCredits Int @default(0)` — credits awarded to referrer on referee's first booking; 0 = disabled
- `Referral`: `referrerId`, `refereeId`, `studioId`, `rewardCredits`, `rewarded Boolean`
- `Waiver`: `studioId`, `title`, `body Text`, `isActive Boolean @default(true)`, `version Int`. Replacing a waiver deactivates the old one and creates a new version. `WaiverSignature`: `waiverId`, `memberId`, `signedAt`, `ipAddress?` — `@@unique([waiverId, memberId])`.
- `Member.creditWarningSentAt DateTime?` — tracks last credit expiry warning email; nightly job skips if sent within 7 days

Seed (`packages/db/src/seed.ts`): 1 studio (Packd Demo), Stockholm City location, 2 rooms (Ride Room cap 20, The Floor cap 16), 3 templates, 1 instructor (Alex Rivera), 3 plans, ~26 sessions.

## Security model

- **Roles**: `admin=5`, `brand_admin=5`, `franchise_admin=4`, `studio_admin=3`, `instructor=2`, `fronthost=2`, `member=1`
- `fronthost` and `instructor` share rank 2 — both pass `requireRole('instructor')` but not `requireRole('studio_admin')`
- **Dual-role**: `app_metadata.roles[]` for all roles, `app_metadata.role` for primary. `DualRoleDashboard` renders for users with both `fronthost` + `instructor`.
- **Multi-studio**: `app_metadata.studioIds[]` — `assertStudioAccess` (in `routes/admin-shared.ts`) checks JWT `studioIds` first (fast path), then DB `member.studioId` + `member.studioIds` (fallback). Single authoritative copy. Most routes use `config: { studioIdFrom: 'querystring'|'params'|'body' }` so the `studio-access-plugin` enforces it automatically; routes that derive studioId from a DB lookup keep a manual call.
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
                           # reminder, waitlist promotion, staff invite, payment failed,
                           # win-back, credit expiry warning, first-class followup,
                           # referral reward, franchise broadcast, session announcement
      logger.ts            # pino logger instance
      stripe-sync.ts       # Stripe product/price create/update/archive
      studio-access-plugin.ts  # Fastify plugin: config.studioIdFrom auto-enforces
                               # studio access without manual assertStudioAccess() calls
      studio-ctx.ts        # withStudioCtx() — RLS context helper
      supabase-admin.ts    # Supabase admin API helpers + revokeUserSessions()
    jobs/index.ts          # pg-boss handlers: no-show fee, late cancel, reminders,
                           # membership renewal, credit expiry sweep + warning,
                           # win-back emails, first-class followup
    routes/
      admin.ts             # thin barrel — registers 5 sub-plugins
      admin-shared.ts      # assertStudioAccess + validateSelectQuery (single source)
      admin-sessions.ts    # session list, bookings view, check-in, bulk cancel/sub
                           # checkInstructorConflict() — blocks double-booking on reschedule
      admin-members.ts     # member CRUD, credits, notes, subscriptions, guest passes,
                           # purchases, audit-log read
      admin-analytics.ts   # stats, leaderboard, analytics (capped at 2000 sessions)
                           # also returns allowMemberPause, referralRewardCredits
      admin-sales.ts       # product sales, guest check-in
      admin-exports.ts     # CSV exports + custom SELECT query (10/min rate limit)
                           # GET /export/staff-pay supports studioId=all for franchise_admin
      availability.ts      # instructor availability blocks
      bookings.ts          # member booking create/cancel/checkin
                           # accepts memberNote; triggers referral reward + first-class followup on first booking
      brands.ts            # brand management; POST /brands/:id/franchises; POST /brands/:id/franchise-admins
      franchise.ts         # franchise/studio management, instructor/fronthost permissions
                           # GET /franchise/staff — all staff with studioIds + instructor pay rates
                           # GET /franchise/all-admins — all studio_admins aggregated
                           # GET/POST/DELETE /franchise/promos — franchise-wide promo codes
                           # POST /franchise/broadcast — bulk email to members (2/min rate limit)
      ical.ts              # iCal feeds: /member/:id/:token, /instructor/:id/:token, /fronthost/:id/:token
      integrations.ts      # Mariana Tek integration config + member/session sync
      memberships.ts       # membership plans + subscriptions
                           # POST /subscriptions/:id/self-pause — member self-pause (checks allowMemberPause)
      members.ts           # member profile, me, stats, POST /ensure
                           # GET /me/referral, POST /referral/apply
                           # PATCH /me/email-preferences
                           # GET /me/receipts, GET /me/export (GDPR), DELETE /me (GDPR)
      networks.ts          # studio networks (cross-location booking)
      products.ts          # product CRUD + Stripe sync
      promos.ts            # per-studio promo codes
      rooms.ts             # room + layout + station management
      schedule.ts          # member-facing schedule (includes userWaitlistPosition)
      schedules.ts         # class schedule (recurring) management + month view
                           # checkInstructorConflict() on substitute assignment
      shifts.ts            # staff shift CRUD (GET/mine, POST, PATCH, DELETE) at /admin/shifts
      shift-patterns.ts    # recurring shift patterns (GET, POST, PATCH, DELETE) at /admin/shift-patterns
                           # POST generates StaffShift instances 12w out; PATCH drops future + regenerates
      staff.ts             # staff invite → /accept-invite URL; POST /accept-invite applies role+studioId
                           # pay rates: PATCH /instructors/:id and PATCH /:id/hourly-pay are franchise_admin only
      stripe.ts            # checkout (with tax rate), webhook, refund, replay, customer portal
                           # checkout.session.completed captures stripeReceiptUrl on ProductSale
      studios.ts           # studio settings; POST /studios/:id/copy-from/:sourceId (franchise_admin)
      waitlist.ts          # waitlist join/leave/promote
      webhooks.ts          # Mariana Tek inbound webhooks
    schemas.ts             # Shared Zod primitives: Id, StudioIdQuery, CursorQuery,
                           # ISODateTime, DateString, IdParam, StaffRole, BookingStatus …
    __tests__/             # 197 Vitest unit tests across 22 files
  web/src/
    app/
      accept-invite/       # /accept-invite — staff invitation acceptance page (auth + role apply)
      onboarding/          # /onboarding — franchise_admin only (guarded); 7-step wizard
                           # steps: Studio → Location → Classes → Policy → Import → Invite → Done
      platform/            # /platform — admin-only; brand + franchise management UI (PlatformDashboard)
    components/
      ScheduleView.tsx     # Member schedule shell + location picker
      AccountView.tsx      # Member account page; fetches allowMemberPause + referralEnabled from studio
      schedule/            # ClassCard, SessionDetailView (booking note field), DayTabs, FilterBar
      admin/               # AdminShell (mgmt/front-desk toggle), SessionPanel
      calendar/            # CalendarView (week/month/schedules), ScheduleModal, SubstituteModal
      franchise/
        FranchiseDashboard.tsx      # tabs: Studios, Networks, Analytics, Promos, Broadcast,
                                    # Studio Admins, Staff, Permissions, Brands (admin only)
        FranchiseStaffRoster.tsx    # all staff with studio chips; expandable pay rate editor
        FranchisePermissionsRoster.tsx  # all staff permissions; studio-context chip for multi-studio instructors
        FranchiseAdminsRoster.tsx   # all studio_admins; studio chips clickable to remove from that studio
      studio/              # StudioManagerDashboard, RoomsTab, PermissionsTab,
                           # SettingsTab (3-tab: general/policies/features)
                           # Policies tab: late cancel, no-show, pause rules, allowMemberPause,
                           #               taxRatePct, referralRewardCredits
                           # StaffTab — pay rates read-only for studio_admin (set by franchise_admin)
      room/                # RoomMapView, RoomMapEditor, SessionRoomMap (S/M/L/XL font), SpotPicker
      fronthost/           # FronthostDashboard, MemberDrawer, CreditModal
      member/
        MemberHistoryView.tsx
        MemberProfilePage.tsx
        AccountExtrasSection.tsx  # collapsible sections: referral widget, email prefs,
                                  # self-pause (if enabled), receipts, GDPR export/delete
      dual/                # DualRoleDashboard
      onboarding/          # OnboardingFlow + step components (StepImport, StepInviteAdmin added)
      brand/               # BrandDashboard — franchise creation, franchise admin assignment,
                           # cross-franchise analytics, members, classes
      platform/            # PlatformDashboard — brand CRUD, franchise creation, franchise admin
                           # assignment (admin-only; guarded in /platform page)
    lib/
      api.ts               # Legacy hand-written client; new code uses api-client.ts
      api-client.ts        # Typed client (openapi-fetch + api-types.generated.ts); use for new code
                           # namespaces: bookings, waitlist, members, waivers; makeApiClient() for raw access
      api-types.generated.ts  # Auto-generated from openapi.json via openapi-typescript; run
                              # `npm run generate:types` after any route schema change
      supabase/            # client.ts + server.ts
      audit.ts             # (frontend) audit log display helpers
    middleware.ts          # Session refresh
packages/
  db/prisma/schema.prisma
  db/src/seed.ts
  types/src/index.ts       # Shared types (MemberProfile.activeSubscription includes id)
e2e/
  global-setup.ts          # Creates test users in Supabase, seeds credits, saves auth state
  fixtures.ts              # authedPage + adminPage fixtures (load .auth/ saved state)
  auth.spec.ts             # Auth flow tests
  booking.spec.ts          # Book → verify booked → cancel → verify unbooked; credit balance deduct/restore
  schedule.spec.ts         # Schedule structure tests
  frontdesk.spec.ts        # Admin dashboard, member search, check-in
  waiver.spec.ts           # Waiver gate: unsigned → modal → sign → book; pre-signed → book directly
  performance.spec.ts      # LCP, CLS, API latency benchmarks
.github/workflows/ci.yml   # Unit tests + typecheck + OpenAPI drift check on every push;
                           # E2E on PRs (needs 6 GitHub secrets: SUPABASE_URL, SUPABASE_ANON_KEY,
                           # SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL, PGBOSS_DATABASE_URL, STUDIO_ID)
docs/
  deploy-runbook.md        # Zero-downtime deploy strategy + expand/contract migration pattern
  secret-rotation.md       # Rotation procedures for ICAL_SECRET, INVITE_SECRET, Stripe, Supabase
  soc2-controls.md         # SOC 2 TSC control mapping + gap list for formal audit
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
- **Pay rate access**: `PATCH /staff/:memberId/hourly-pay` and `PATCH /staff/instructors/:instructorId` require `franchise_admin`. StaffTab shows rates as read-only for studio_admin. Editing is in `FranchiseStaffRoster` (expandable row per person, per-studio for instructors).
- **Vitest booking mocks**: `prisma.booking` mock must include `count: vi.fn().mockResolvedValue(2)` (first-booking referral check) and `prisma.referral: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() }`. Missing either causes 500 in booking tests.
- **Email preferences**: `Member.emailPreferences Json` defaults to `{}` (treated as all true). Check with `(prefs.classReminder ?? true)` pattern — explicit `false` opts out, missing key = opted in.
- **Staff invite flow**: `POST /staff/invite` generates an HMAC-SHA256 signed token (7-day expiry, base64url, signed with `INVITE_SECRET ?? ICAL_SECRET`) and sends it as `&token=<token>` in the invite URL to `/accept-invite?email=&studio=&studioId=&role=&token=`. The `/accept-invite` page reads the token and includes it in the POST body. `POST /staff/accept-invite` verifies the token (constant-time `timingSafeEqual`) before applying `app_metadata` role + studioIds via Supabase admin API.
- **Referral reward**: fires in `POST /bookings` after first confirmed booking (`prisma.booking.count === 1`). Finds unrewarded `Referral` for the member, grants credits to referrer, marks as rewarded. Non-fatal (wrapped in try/catch).
- **Staff conflict detection**: `checkInstructorConflict()` defined in both `schedules.ts` and `admin-sessions.ts`. Checks for overlapping sessions (status ≠ CANCELLED). Applied on: substitute assignment (schedules.ts), session reschedule/time-change (admin-sessions.ts). NOT applied on bulk schedule generation (impractical — skip by design).
- **Tax / VAT**: `Studio.taxRatePct` + `stripeTaxRateId`. On checkout: if `taxRatePct > 0`, creates Stripe TaxRate once and caches ID on Studio. Passed as `default_tax_rates` to checkout session.
- **Franchise onboarding wizard**: 7 steps: Studio details → Location → Rooms → Policy → Import from existing studio (optional) → Invite studio admin (optional) → Done. Requires `franchise_admin` role — other roles redirected to `/dashboard`. Cancel button: "Cancel" before studio created, "Finish later →" after (with confirm dialog).
- **Pagination pattern**: cursor-based, `{ items[], nextCursor: string|null, hasMore: bool }`. Params: `?cursor=<id>&take=<n>` (default 50, max 200). Implemented on `GET /admin/members` and `GET /franchise/staff`. Audit log uses same pattern. Apply to all new list endpoints.
- **DB migrations**: **never use `prisma db push`** — always use `prisma migrate dev --name <description>` from `packages/db/`. The migration track was restored on 2026-05-31 with a `current_state_baseline` migration; `prisma migrate status` shows "Database schema is up to date". All future schema changes must go through `migrate dev`. `prisma migrate dev` requires a shadow database: set `shadowDatabaseUrl` in `packages/db/.env` pointing to a separate Postgres instance (local or a second Supabase project). Without it, `migrate dev` fails. Workaround: use `prisma migrate dev --create-only` to generate the SQL, then apply manually with `migrate deploy`.
- **Waivers**: `Waiver` model (studioId, title, body, isActive, version) + `WaiverSignature` (waiverId, memberId, signedAt, ipAddress). Routes at `/waivers` prefix: `GET /active?studioId=`, `POST /:id/sign`, `GET /admin?studioId=`, `PUT /admin` (upsert — deactivates previous and creates new version), `DELETE /admin?studioId=`. Booking gate in `bookings.ts`: checks for active waiver on the session's studio; returns `{ error: 'WAIVER_REQUIRED', waiverId }` (403) if member hasn't signed. Frontend should show WaiverModal when it receives this error.
- **PAST_DUE booking gate**: members with any `PAST_DUE` subscription cannot book (402). Privileged staff (fronthost+) bypass this check.
- **allowMemberPause default**: changed to `false` — studios must opt in to allow member self-pause (previously defaulted to `true`, silently enabling it for all studios).
- **Credit expiry warning dedup**: `Member.creditWarningSentAt DateTime?` — nightly job skips sending if a warning was already sent within the last 7 days.
- **`GET /franchise/studios`** returns `revenueThisMonthCents` (product sales, non-refunded, this calendar month) alongside the existing member/session/fill-rate stats.
- **Zod validation**: all routes carry `schema: { body, querystring, params }` using `@fastify/type-provider-zod`. Optional-body routes use `.nullish()` not `.optional()` — Fastify passes `null` (not `undefined`) for missing bodies. Shared primitives live in `src/schemas.ts`.
- **Studio-access middleware**: `lib/studio-access-plugin.ts` — add `config: { studioIdFrom: 'querystring' | 'params' | 'body' }` to a route and studio access is enforced automatically as a `preHandler`. Only use manual `assertStudioAccess` when studioId must be resolved from a DB record (e.g. per-member endpoints, sale ownership checks).
- **Session revocation**: `revokeUserSessions(userId)` in `supabase-admin.ts` — call after any role change (staff removal, role downgrade) so the user's JWT is immediately invalidated. Fire-and-forget, non-fatal.
- **Connection pooling**: `DATABASE_URL` → Supabase pgBouncer pooler (port 6543, `?pgbouncer=true`). `PGBOSS_DATABASE_URL` → direct connection (port 5432, no pgBouncer) — pg-boss uses advisory locks + LISTEN/NOTIFY which break with transaction-mode pooling. `DIRECT_URL` → direct connection used by Prisma for migrations only.
- **Ops alerting**: `sendOpsAlert(subject, body)` in `lib/email.ts` — fires to `OPS_EMAIL` via Resend. All pg-boss job handlers wrapped with `work(name, handler)` in `jobs/index.ts` which auto-alerts on failure. Stripe webhook handler also wrapped with try/catch that alerts.
- **iCal token rotation**: set `ICAL_SECRET_PREVIOUS=<old>` + `ICAL_SECRET=<new>` — tokens signed with either key are accepted. Drop PREVIOUS after ~30 days. Token verification uses `timingSafeEqual` on both keys. See `docs/secret-rotation.md`.
- **OpenAPI spec + typed client**: `npm run generate:types` runs `apps/api/src/generate-openapi.ts` (builds Fastify app without `listen()`, writes `apps/api/openapi.json`) then `openapi-typescript` (writes `apps/web/src/lib/api-types.generated.ts`). CI checks both files are up to date on every push.
- **Session revocation**: `revokeUserSessions(userId)` called after every role change — grant (`POST /staff`), accept-invite, and removal (`DELETE /staff/:memberId`). Forces re-auth so the new JWT reflects the updated role immediately.

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

### Product
- [ ] Conflict detection on bulk schedule creation — skipped by design; only applied on single-session edits and substitute assignment.
- [ ] Minimum class threshold / auto-cancel — no `minCapacity` field or automated cancellation if bookings fall below threshold before class.
- [ ] Class series / multi-session bookings — no concept of booking a 6-week course as a unit.
- [ ] Receipt PDF generation — currently exposes Stripe's hosted receipt URL; no first-party PDF.
- [ ] SMS notifications — email only; no SMS channel.
- [ ] Pagination on remaining high-volume endpoints — `GET /franchise/all-admins`, `GET /franchise/promos`, brand member lists.

### Enterprise / operational
- [ ] Backup restore test — Supabase PITR enabled but restore procedure untested. Run a restore drill against a staging environment.
- [ ] Business continuity plan — define what happens if Supabase, Stripe, or Resend are unavailable.
- [ ] External penetration test — internal audit found 30 issues (all fixed). Schedule a third-party pen test before enterprise launch.

### Technical debt
- [ ] api.ts full migration to api-client.ts — critical paths (bookings, waitlist, members, waivers) now use typed `api-client.ts`; remaining admin/franchise/studio methods still use the legacy hand-written client. Migrate call-sites and delete deprecated methods once all are replaced.
