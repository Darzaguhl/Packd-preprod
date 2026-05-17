# Packd — Claude Context

Boutique fitness studio management platform (think Zingfit / Mariana Tek, used by studios like Barry's). Full-stack monorepo.

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
| Unit tests | Vitest 3 |
| E2E tests | Playwright 1.60 |
| Mobile | Expo (React Native) — not yet built |

## Ports

- Web: `http://localhost:3001` (Next.js dev)
- API: `http://localhost:4000` (Fastify)

## Running the project

```bash
# From repo root
npm install          # install all workspace deps
npm run db:generate  # generate Prisma client (required after fresh install)

# In separate terminals:
cd apps/api && npm run dev    # API on :4000
cd apps/web && npm run dev    # Web on :3001 (or :3000)

# Tests
npm test                      # Vitest unit tests (26 tests, all passing)
npm run test:coverage         # with coverage report
npm run test:e2e              # Playwright E2E (needs web + API running)
```

## Key environment files

**`apps/api/.env`**
```
DATABASE_URL=postgresql://postgres:<password>@db.<project>.supabase.co:5432/postgres
SUPABASE_URL=https://<project>.supabase.co
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
PORT=4000
```

**`apps/web/.env.local`**
```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STUDIO_ID=<seeded-studio-id>
```

## Architecture decisions & gotchas

### Auth
- Supabase uses publishable key format (`sb_publishable_...`), not the legacy anon key
- JWT verification uses JWKS (`jose` library) — **do not add an issuer check**, Supabase's issuer includes `/auth/v1` suffix which differs from the base URL
- `requireAuth` is a Fastify preHandler; it stores the decoded user on `request.user`

### Next.js 15 + Supabase SSR
- Server Components cannot set cookies — `setAll` in `apps/web/src/lib/supabase/server.ts` wraps the cookie setter in `try/catch`
- Session refresh is handled by `apps/web/src/middleware.ts` (runs on all non-static routes)
- Token fetching for API calls must happen client-side in `useEffect`, not in Server Components

### pg-boss v10
- Queues must be explicitly created with `boss.createQueue(name)` before scheduling jobs
- Create queues **sequentially** (for…of loop), not with `Promise.all` — parallel DDL causes deadlocks

### Tailwind CSS v4
- Uses `@import "tailwindcss"` in `globals.css` (not the old `@tailwind` directives)
- Requires `postcss.config.js` with `@tailwindcss/postcss` plugin
- No `tailwind.config.js` needed for basic usage

### React versions
- Root `package.json` has `"overrides"` pinning React 19 — Expo pulled in React 18 which conflicted with `react-dom` 19
- Do not remove the overrides block

### Vitest + Fastify 5
- `vi.fn()` as a Fastify preHandler causes requests to hang — always use `vi.fn().mockResolvedValue(undefined)` for preHandler mocks
- This is because Fastify 5 awaits the preHandler return value; synchronous `undefined` stalls the lifecycle
- Prisma `$transaction` mock: define all model objects as named `vi.fn()` instances at factory scope, then share the same references in BOTH the `prisma` export AND the `$transaction` proxy — this ensures `vi.mocked(prisma.x.y).mockResolvedValue(...)` works for calls inside transactions
- `$transaction` callback form: `vi.fn(async (fn) => fn(tx))` where `tx` is the shared model object; array form: `vi.fn(async (arr) => Promise.all(arr))`
- Custom errors in routes must use `{ statusCode: N }` (not `{ code: 'NAME' }`) — Fastify's error handler only reads `err.statusCode`

## Database schema (17 models)

```
Studio → Location → Room → RoomLayout → Station
Studio → Instructor
Studio → ClassTemplate → ClassSession → Booking → Member
                      ↗ ClassSchedule (recurring)
                                     ↘ WaitlistEntry
Member → CreditBalance + CreditTransaction
Member → MembershipSubscription → MembershipPlan
Studio → CancellationPolicy
```

Key additions:
- `ClassSchedule` — recurring schedule master (`daysOfWeek Int[]`, `startTime`, `durationMin`, `intervalWeeks @default(1)`, `validFrom/validUntil`, `isActive`)
- `ClassSession.scheduleId` — links back to `ClassSchedule` (nullable, onDelete: SetNull)
- `ClassSession.substituteInstructorId` — per-session override, preserved when schedule is edited
- `RoomLayout` — named layout with `widthM`, `lengthM`, `isActive`; linked to `Room`
- `Station` — positioned equipment (`type: StationType`, `xM`, `yM`, `rotation`, `label`); linked to `RoomLayout`
- `Booking.stationId` — links a confirmed booking to a specific station for spot assignment

Seed data lives in `packages/db/src/seed.ts`:
- 1 studio: Packd Demo Studio
- 1 location: Stockholm City
- 2 rooms: Ride Room (cap 20), The Floor (cap 16)
- 3 class templates: Cycling, HIIT, Yoga
- 1 instructor: Alex Rivera
- 3 membership plans
- ~26 sessions spread over 7 days

## Security model

- **Role source**: Role is read exclusively from `app_metadata` in the Supabase JWT (server-controlled). `user_metadata` is never trusted for access control.
- **Role allowlist**: `'admin' | 'franchise_admin' | 'studio_admin' | 'instructor' | 'fronthost'` get elevated roles — anything else defaults to `'member'`.
- **Role ranks**: `admin=5`, `franchise_admin=4`, `studio_admin=3`, `instructor=2`, `fronthost=2`, `member=1`. `fronthost` and `instructor` share rank 2 — both pass `requireRole('instructor')` guards but not `requireRole('studio_admin')`.
- **fronthost permissions**: Can check in members, handle payments (credit adjustments), and access daily session/stats views. Cannot edit layouts, manage schedules, or access franchise-level data. Instructors default `canCheckInMembers: false`.
- **Instructor permissions** (`InstructorPermissions` JSON on `Instructor` model): `canCheckInMembers`, `canManageWaitlist` (true by default), `canManageBookings`, `canViewMemberContact`, `canEditSessionDetails`, `canCancelSession`, `canCreateSchedules` (all false by default). Managed via PermissionsTab; `canCreateSchedules` gates schedule creation/edit/delete UI in CalendarView.
- **Tenant isolation**: All admin routes call `assertStudioAccess(userId, studioId)` which checks `Member.studioId === studioId`. An admin from studio A cannot access studio B's data.
- **Race conditions**: Booking creation, cancellation+waitlist-promote, and waitlist-join all run inside `prisma.$transaction()`. DB-level `@@unique([sessionId, memberId])` is the final guard. P2002 on `booking.create` is caught and re-thrown as 409 to handle TOCTOU races.
- **Re-booking**: `CANCELLED` and `LATE_CANCELLED` booking rows are reactivated via `update` (not `create`) to avoid violating the unique constraint. Booking route checks for all three statuses before deciding whether to update or create.
- **Past-class booking**: Members cannot book classes whose `startsAt` has passed (400). Admins, franchise_admins, studio_admins, instructors, and fronthosts bypass this check and can book/adjust past or running classes.
- **Status validation**: Session status updates validated against explicit allowlist `['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']`.
- **Setting admin role**: Use Supabase Admin API — `PUT /auth/v1/admin/users/:userId` with body `{"app_metadata": {"role": "admin"}}` and service role key. No script needed; curl works fine.

## What's been built

### API (`apps/api/src/routes/`)
- `schedule.ts` — `GET /schedule/:studioId` — lists sessions with booking status per user
- `bookings.ts` — `POST /bookings`, `DELETE /bookings/:id`, `POST /bookings/:id/checkin`; members (role=member or no role) are blocked from booking past sessions (400); LATE_CANCELLED bookings are re-activated via `update` not `create` to avoid P2002; cancel clears `stationId: null`
- `waitlist.ts` — `POST /waitlist`, `DELETE /waitlist/:id`, `POST /waitlist/:id/confirm`
- `members.ts` — `GET /members/me`
- `studios.ts` — `GET/POST /studios`, `PATCH/DELETE /studios/:id`, `GET /studios/:id/rooms`, `POST /studios/:id/rooms`, `DELETE /studios/:id/rooms/:roomId`, `POST /studios/onboard`
- `admin.ts` — admin-only routes behind `requireAdmin` (role from `app_metadata`)
  - `GET /admin/sessions?studioId=&date=` — daily session list with booked counts; includes `instructorUserId` for client-side "my classes" filtering
  - `GET /admin/sessions/:id/bookings` — attendee list with check-in status
  - `POST /admin/sessions/:id/checkin/:bookingId` — toggle check-in
  - `PATCH /admin/sessions/:id` — update session status
  - `GET /admin/stats?studioId=` — today's headline stats; includes `studioName` for NavBar display
  - `GET /admin/members/search?studioId=&q=` — fuzzy search members by name/email (up to 10 results, includes creditBalance and membershipStatus)
  - `POST /admin/members/:memberId/credits` — adjust credit balance (positive or negative integer, type: MANUAL_ADJUSTMENT)
- `rooms.ts` — room layout and spot assignment
  - `GET /rooms/:id/layout` — active layout with stations
  - `POST /rooms/:id/layout` — save/replace layout
  - `GET /rooms/:id/sessions/:sessionId/spots` — stations + assignments (includes `creditBalance`, `membershipStatus`)
  - `POST /rooms/:id/sessions/:sessionId/spots` — assign booking to station
  - `POST /rooms/:id/sessions/:sessionId/my-spot` — member picks own spot
- `schedules.ts` — recurring class schedule management
  - `GET /schedules?studioId=&weekStart=` — sessions + resources for a Mon–Sun week
  - `GET /schedules/all?studioId=` — all active ClassSchedule records
  - `POST /schedules` — create recurring schedule + generate N weeks of sessions
  - `PATCH /schedules/:id` — update schedule (deletes future unbooked/unsubstituted sessions, regenerates)
  - `DELETE /schedules/:id` — deactivate + remove future unbooked sessions
  - `PATCH /schedules/sessions/:sessionId/substitute` — set/clear substitute instructor
  - `GET /schedules/month?studioId=&year=&month=` — session counts per day for month grid
  - `GET /schedules/orphaned?studioId=` — unique session patterns with no schedule link
  - `DELETE /schedules/orphaned` — delete future unbooked orphaned sessions by pattern
- `staff.ts` — `GET/POST /staff`, `DELETE /staff/:memberId`; valid roles: `fronthost`, `instructor`; creating instructor role also upserts `Instructor` DB record; deleting removes `Instructor` record if present
- `franchise.ts` — multi-studio management
  - `GET /franchise/studios` — all studios summary
  - `GET /franchise/studios/:id/instructors` — instructors with permissions
  - `PATCH /franchise/studios/:id/instructors/:instructorId/permissions` — update instructor permissions
- `stripe.ts` — Stripe webhook handler stub

### Web (`apps/web/src/`)
- `/login` — sign in / sign up with Supabase Auth
- `/onboarding` — multi-step studio setup wizard (5 steps)
- `/schedule` — main member-facing schedule view (fully working)
- `/dashboard` — admin dashboard (admin role required)

### Schedule UI components
- `ScheduleView.tsx` — main shell, two-column layout (schedule + calendar sidebar); reads `userRole` from `session.user.app_metadata` and derives `isPrivileged` (non-member), passed as `privileged` prop to cards and detail view
- `schedule/ClassCard.tsx` — drag-ready card; past classes are greyed out and non-clickable for members; accepts `privileged` prop to bypass the past-class lock
- `schedule/SessionDetailView.tsx` — full session detail view opened when a card is clicked; spot picker with book-by-spot-click flow; cancel button always visible (greyed out until spot picked); members locked out of all actions on past classes via `isPast = !privileged && startsAt < now`; tapping own spot on the map cancels the booking (red hover state with ✕)
- `schedule/DayTabs.tsx` — 7-day tabs with integrated prev/next arrows, today outline, selected filled
- `schedule/FilterBar.tsx` — sport filter pills
- `schedule/CapacityBar.tsx` — green/amber/red fill bar
- `schedule/MiniCalendar.tsx` — monthly grid with ISO week numbers per row, sport-colored booking dots
- `schedule/constants.ts` — SPORT_CONFIG color map

### Admin UI components
- `admin/AdminDashboard.tsx` — stat cards (today's classes, bookings, waitlist, members), date picker, session list with fill bars, slide-in panel
- `admin/SessionPanel.tsx` — attendee list with avatar initials + credit balance, check-in toggle; three-segment attendance bar (black=checked-in, amber=booked-not-in, light-gray=empty); `canCancel` prop (default true) — instructors see the panel without the cancel button

### Franchise / studio management components
- `franchise/FranchiseDashboard.tsx` — multi-studio overview cards, drill into per-studio management; `onStudioUpdate` callback keeps cards in sync after settings save without reload
- `studio/StudioManagerDashboard.tsx` — tabbed per-studio view; role-aware: instructors see Today + Calendar only; clicking a session opens room map directly; `myClassesOnly` filter defaults ON for instructors; loads own `Instructor` record to pass `myInstructorId` + `myPermissions` to CalendarView; studio name shown in NavBar for all roles
- `studio/RoomsTab.tsx` — room list + layout editor (editor-only, no session features)
- `studio/PermissionsTab.tsx` — per-instructor permission toggles with accordion UI; toggle fix: explicit `left-1 translate-x-0/translate-x-4` anchoring required; includes `canCreateSchedules` permission
- `studio/SettingsTab.tsx` — studio name, timezone (grouped optgroup, ~80 zones), currency (34 options); calls `onStudioUpdate` on save
- `studio/StaffTab.tsx` — manage fronthosts and instructors; violet badge for instructors; shortcut to Permissions tab for instructor rows; creating an instructor role upserts an `Instructor` DB record; removing it deletes the record

### Calendar components (`components/calendar/`)
- `CalendarView.tsx` — three views: `week` (time grid with overlap layout), `month` (sport-dot grid), `schedules` (master recurring + orphaned sessions)
  - Critical: `isoDate()` uses `getFullYear()/getMonth()/getDate()` not `.toISOString()` to avoid UTC offset shifting the week
  - Overlap layout: sessions sorted by start, grouped by overlap, rendered side-by-side with `leftFrac`/`widthFrac`
  - Props: `canCreateSchedules` (default true) gates all schedule creation/edit/delete UI; `filterInstructorId` enables "My classes" filter pill (defaults ON); `visibleSessions` derived from filter state, includes sessions where instructor is primary or substitute
- `ScheduleModal.tsx` — create/edit recurring schedule; day-of-week pills; frequency: 1/2/3/4 weeks; pre-fills from orphaned session patterns
- `SubstituteModal.tsx` — per-session substitute instructor assignment

### Room map components (`components/room/`)
- `RoomMapView.tsx` — orchestrator with `variant` prop: `'editor'` (layout only) or `'checkin'` (session spots only); also handles check-in toggles via `api.admin.checkin`; always calls `createClient().auth.getSession()` for a fresh token before API calls
- `RoomMapEditor.tsx` — drag-to-place floor plan editor; palette drag + canvas move + double-click rename + hover delete
- `SessionRoomMap.tsx` — pixel-scale check-in map (90px/m, 130×100px min per station); two-panel layout: compact station list (w-52, sorted by label, quick ✓ check-in button) + scrollable canvas; shows member name, membership badge, credit balance, check-in toggle; DnD assignment with lock — checked-in members cannot be dragged and their target station blocks drops; drag IDs namespaced: canvas uses bare `bookingId`, list uses `list-drag-{bookingId}`, droppable list rows use `list-{stationId}`
- `SpotPicker.tsx` — member-facing spot map; own spot shows ✓/"You" normally, red ✕/"Cancel" on hover; clicking own spot calls `onPick(null)` which the parent wires to cancel the booking
- `constants.ts` — `STATION_META` (icon, color, physical size in metres per type), `GRID_STEP`, `snapToGrid`

### Fronthost components (`components/fronthost/`)
- `FronthostDashboard.tsx` — full-screen layout: session sidebar (w-72) with today's sessions, LIVE badge, fill bar, date picker; clicking a session loads `<RoomMapView variant="checkin" />`; "+ Credits" button opens CreditModal
- `CreditModal.tsx` — member search via `api.admin.searchMembers`; preset amounts (+5, +10, +20, +30) with deduct toggle; manual amount + optional note; calls `api.admin.adjustCredits`

### Tests
- `apps/api/src/__tests__/booking.test.ts` — 12 unit tests (create 201, full class 409, insufficient credits 402, cancelled session 400, missing body 400, past class rejected for member 400, past class allowed for admin 201, LATE_CANCELLED re-book via update 201, on-time cancel 200, late cancel 200, wrong user cancel 403, cancel clears stationId)
- `apps/api/src/__tests__/waitlist.test.ts` — 6 unit tests (join empty 201, join with queue 201, missing body 400, confirm valid 200, expired window 410, wrong user 403)
- `apps/api/src/__tests__/checkin.test.ts` — 3 unit tests (toggle on, toggle off + clears checkedInAt, wrong session booking 404)
- `apps/api/src/__tests__/credits.test.ts` — 5 unit tests (add credits, deduct credits, amount=0 rejected, non-integer rejected, missing member 404)
- `e2e/auth.spec.ts` — redirect, form render, mode toggle, invalid credentials
- `e2e/schedule.spec.ts` — day tabs, selected tab, class cards, week nav, sport filter, day switching
- `e2e/booking.spec.ts` — book button, waitlist button
- `e2e/performance.spec.ts` — schedule LCP < 2500ms, schedule CLS < 0.1, login TTFB < 800ms, dashboard LCP < 3000ms, dashboard CLS < 0.1, schedule API < 500ms, admin sessions API < 600ms, member search API < 500ms
- `e2e/fixtures.ts` — `authedPage` (member, lands /schedule) and `adminPage` (admin, lands /dashboard) fixtures

## What's next

### High priority
- [ ] Member account page — credit balance, upcoming bookings, cancel from there
- [ ] Booking confirmation flow — post-book state, credit deduction visible to user
- [ ] Push/email notifications when promoted from waitlist

### Medium priority
- [ ] Stripe credit purchase flow — buy credit packs, webhook updates CreditBalance
- [ ] Membership subscription management — upgrade/downgrade/cancel
- [ ] Admin drag-to-reschedule — wire up the DnD stub in ScheduleView (`handleDragEnd`)

### Lower priority
- [ ] Expo mobile app — auth, schedule view, booking (Expo Router)
- [ ] No-show fee job — `session.no-show` queue handler
- [ ] Nightly maintenance job — `nightly.maintenance` queue handler
- [ ] Membership renewal reminders — `membership.renewal-reminder` queue handler
- [ ] Multi-location support — location picker in schedule view
- [ ] Instructor portal — view own schedule, attendance

## File map (key files only)

```
apps/
  api/
    src/
      server.ts          # Fastify app setup, CORS, plugin registration
      lib/auth.ts        # requireAuth preHandler, JWKS verification
      jobs/index.ts      # pg-boss setup and job handlers
      routes/            # All API route handlers
      __tests__/         # Vitest unit tests
  web/
    src/
      app/               # Next.js App Router pages
      components/
        ScheduleView.tsx  # Main schedule shell
        schedule/         # Schedule sub-components
        admin/            # Admin dashboard components
        calendar/         # CalendarView, ScheduleModal, SubstituteModal
        franchise/        # FranchiseDashboard
        studio/           # StudioManagerDashboard, RoomsTab, PermissionsTab, SettingsTab
        room/             # RoomMapView, RoomMapEditor, SessionRoomMap, constants
        fronthost/        # FronthostDashboard, CreditModal
        onboarding/       # Onboarding wizard steps
      lib/
        api.ts            # Typed API client
        supabase/         # Supabase client (client.ts + server.ts)
      middleware.ts       # Session refresh middleware
packages/
  db/
    prisma/schema.prisma  # Full 16-model schema
    src/
      index.ts            # Exports prisma client
      seed.ts             # Demo data seed script
  types/
    src/index.ts          # Shared TypeScript types
e2e/                      # Playwright E2E tests
```
