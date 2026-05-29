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
| DnD | @dnd-kit/core + @dnd-kit/sortable |
| Tests | Vitest 3 (unit) + Playwright 1.60 (E2E) |

## Ports

- Web: `http://localhost:3000`
- API: `http://localhost:4000`

## Running the project

```bash
npm install && npm run db:generate   # fresh install

cd apps/api && npm run dev           # API on :4000
cd apps/web && npm run dev           # Web on :3000

npm test                             # Vitest unit tests
npm run test:e2e                     # Playwright (needs both servers)
```

## Key environment files

**`apps/api/.env`** — `DATABASE_URL`, `SUPABASE_URL`, `CORS_ORIGIN=http://localhost:3000,http://localhost:3001`, `PORT=4000`

**`apps/web/.env.local`** — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (sb_publishable_... format), `NEXT_PUBLIC_API_URL=http://localhost:4000`, `NEXT_PUBLIC_STUDIO_ID`

## Architecture gotchas

### Auth
- Supabase publishable key format (`sb_publishable_...`), not legacy anon key
- JWT via JWKS (`jose`) — **no issuer check** (Supabase issuer has `/auth/v1` suffix)
- Role read from `app_metadata` only — never `user_metadata`
- Set role: `PUT /auth/v1/admin/users/:userId` `{"app_metadata":{"role":"studio_admin"}}` with service role key

### Next.js 15 + Supabase SSR
- Server Components can't set cookies — `setAll` in `supabase/server.ts` is wrapped in `try/catch`
- Token fetching for API calls must be client-side in `useEffect`

### pg-boss v10
- `boss.createQueue(name)` before scheduling — queues are not auto-created
- Create queues **sequentially** (for…of), not `Promise.all` — parallel DDL deadlocks

### Vitest + Fastify 5
- preHandler mocks: `vi.fn().mockResolvedValue(undefined)` — synchronous `undefined` stalls the lifecycle
- Prisma `$transaction` mock: share the same model `vi.fn()` instances in both the `prisma` export and the `$transaction` proxy
- `$transaction` callback form: `vi.fn(async (fn) => fn(tx))`; array form: `vi.fn(async (arr) => Promise.all(arr))`
- Custom errors use `{ statusCode: N }` not `{ code: 'NAME' }`

### Tailwind CSS v4
- `@import "tailwindcss"` in `globals.css`; `postcss.config.js` with `@tailwindcss/postcss`; no `tailwind.config.js` needed

### React
- Root `package.json` overrides pin React 19 — do not remove (Expo conflict)

## Database schema

```
Studio → Location → Room → RoomLayout → Station
Studio → Instructor
Studio → ClassTemplate → ClassSession → Booking → Member
                      ↗ ClassSchedule (recurring)   ↘ WaitlistEntry
Member → CreditBalance + CreditTransaction
Member → MembershipSubscription → MembershipPlan
Studio → CancellationPolicy
Studio → Product
```

Key fields:
- `ClassSchedule`: `daysOfWeek Int[]`, `startTime`, `durationMin`, `intervalWeeks @default(1)`, `validFrom/validUntil`, `isActive`
- `ClassSession`: `scheduleId` (nullable → SetNull), `substituteInstructorId`
- `RoomLayout`: `widthM`, `lengthM`, `isActive`
- `Station`: `type: StationType`, `xM`, `yM`, `rotation`, `label`
- `Booking.stationId` — spot assignment
- `Member.staffRoles String[] @default([])` — all roles; `studioIds` in `app_metadata` for multi-studio
- `Product`: `category @default("Other")`, `priceInCents`, `creditsRequired Int @default(0)`, `inStock`; free = both price and credits = 0

Seed (`packages/db/src/seed.ts`): 1 studio (Packd Demo), Stockholm City location, 2 rooms (Ride Room cap 20, The Floor cap 16), 3 templates, 1 instructor (Alex Rivera), 3 plans, ~26 sessions.

## Security model

- **Roles**: `admin=5`, `franchise_admin=4`, `studio_admin=3`, `instructor=2`, `fronthost=2`, `member=1`
- `fronthost` and `instructor` share rank 2 — both pass `requireRole('instructor')` but not `requireRole('studio_admin')`
- **Dual-role**: `app_metadata.roles[]` for all roles, `app_metadata.role` for primary. `DualRoleDashboard` renders for users with both `fronthost` + `instructor`.
- **Multi-studio**: `app_metadata.studioIds[]` — `assertStudioAccess` checks JWT `studioIds` first (fast path), then DB `member.studioId` + `member.studioIds` (fallback). All three copies of this function (`franchise.ts`, `studios.ts`, `integrations.ts`) use this pattern.
- **Booking guards**: past-class booking blocked for members (400); privileged roles (rank ≥ fronthost) bypass. LATE_CANCELLED re-books via `update` not `create` (avoids P2002). Cancel clears `stationId`.
- **Instructor permissions** (JSON on `Instructor`): `canCheckInMembers`, `canManageWaitlist` (true), `canManageBookings`, `canViewMemberContact`, `canEditSessionDetails`, `canCancelSession`, `canCreateSchedules` (all false default).
- `StudioManagerDashboard`: reads role from `session.user.app_metadata.role` as `sessionRole` fallback; `effectiveRole = role ?? sessionRole`.

## File map

```
apps/
  api/src/
    server.ts            # Fastify setup, CORS, plugins
    lib/auth.ts          # requireAuth, JWKS, role helpers
    jobs/index.ts        # pg-boss handlers
    routes/              # schedule, bookings, waitlist, members, studios,
                         # admin, rooms, schedules, staff, franchise,
                         # products, integrations, stripe
    __tests__/           # Vitest unit tests
  web/src/
    app/                 # Next.js pages (login, onboarding, schedule, dashboard)
    components/
      ScheduleView.tsx   # Member schedule shell + location picker
      schedule/          # ClassCard, SessionDetailView, DayTabs, FilterBar, etc.
      admin/             # AdminShell (mgmt/front-desk toggle), SessionPanel
      calendar/          # CalendarView (week/month/schedules), ScheduleModal, SubstituteModal
      franchise/         # FranchiseDashboard
      studio/            # StudioManagerDashboard, RoomsTab, PermissionsTab,
                         # SettingsTab, StaffTab, ProductsTab, AnalyticsTab, QueryTab
      room/              # RoomMapView, RoomMapEditor, SessionRoomMap, SpotPicker, constants
      fronthost/         # FronthostDashboard, MemberDrawer, CreditModal
      dual/              # DualRoleDashboard
    lib/
      api.ts             # Typed API client
      supabase/          # client.ts + server.ts
    middleware.ts        # Session refresh
packages/
  db/prisma/schema.prisma
  db/src/seed.ts
  types/src/index.ts     # Shared types (SessionSlot has locationId/locationName)
e2e/                     # Playwright specs
```

## Backlog

### High priority
- [ ] Push/email notifications when promoted from waitlist
- [ ] Stripe credit purchase flow

### Lower priority
- [ ] Expo mobile app
- [ ] RLS Option B — DB-level tenant isolation via `SET LOCAL app.current_studio_id`
