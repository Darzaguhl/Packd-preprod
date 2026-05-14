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
npm test                      # Vitest unit tests (10 tests, all passing)
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

## Database schema (16 models)

```
Studio → Location → Room
Studio → Instructor
Studio → ClassTemplate → ClassSession → Booking → Member
                                     ↘ WaitlistEntry
Member → CreditBalance + CreditTransaction
Member → MembershipSubscription → MembershipPlan
Studio → CancellationPolicy
```

Seed data lives in `packages/db/src/seed.ts`:
- 1 studio: Packd Demo Studio
- 1 location: Stockholm City
- 2 rooms: Ride Room (cap 20), The Floor (cap 16)
- 3 class templates: Cycling, HIIT, Yoga
- 1 instructor: Alex Rivera
- 3 membership plans
- ~26 sessions spread over 7 days

## What's been built

### API (`apps/api/src/routes/`)
- `schedule.ts` — `GET /schedule/:studioId` — lists sessions with booking status per user
- `bookings.ts` — `POST /bookings`, `DELETE /bookings/:id`, `POST /bookings/:id/checkin`
- `waitlist.ts` — `POST /waitlist`, `DELETE /waitlist/:id`, `POST /waitlist/:id/confirm`
- `members.ts` — `GET /members/me`
- `studios.ts` — `POST /studios/onboard`
- `stripe.ts` — Stripe webhook handler stub

### Web (`apps/web/src/`)
- `/login` — sign in / sign up with Supabase Auth
- `/onboarding` — multi-step studio setup wizard (5 steps)
- `/schedule` — main member-facing schedule view (fully working)

### Schedule UI components
- `ScheduleView.tsx` — main shell, two-column layout (schedule + calendar sidebar)
- `schedule/ClassCard.tsx` — drag-ready card with sport accent bar, capacity bar, book/cancel/waitlist actions
- `schedule/DayTabs.tsx` — 7-day tabs with integrated prev/next arrows, today outline, selected filled
- `schedule/FilterBar.tsx` — sport filter pills
- `schedule/CapacityBar.tsx` — green/amber/red fill bar
- `schedule/MiniCalendar.tsx` — monthly grid with ISO week numbers per row, sport-colored booking dots
- `schedule/constants.ts` — SPORT_CONFIG color map

### Tests
- `apps/api/src/__tests__/booking.test.ts` — 6 unit tests (create, full class, insufficient credits, cancelled session, on-time cancel, late cancel)
- `apps/api/src/__tests__/waitlist.test.ts` — 4 unit tests (join empty, join with queue, confirm, expired window)
- `e2e/auth.spec.ts` — redirect, form render, mode toggle, invalid credentials
- `e2e/schedule.spec.ts` — day tabs, selected tab, class cards, week nav, sport filter, day switching
- `e2e/booking.spec.ts` — book button, waitlist button
- `e2e/performance.spec.ts` — LCP < 2500ms, CLS < 0.1, TTFB < 800ms, API < 500ms

## What's next

### High priority
- [ ] Member account page — credit balance, upcoming bookings, cancel from there
- [ ] Studio admin dashboard — manage sessions, view bookings, check-in screen
- [ ] Booking confirmation flow — post-book state, credit deduction visible to user
- [ ] Push/email notifications when promoted from waitlist

### Medium priority
- [ ] Stripe credit purchase flow — buy credit packs, webhook updates CreditBalance
- [ ] Membership subscription management — upgrade/downgrade/cancel
- [ ] Admin drag-to-reschedule — wire up the DnD stub in ScheduleView (`handleDragEnd`)
- [ ] Spot selection UI — `SpotLayout` type exists in `@packd/types`, needs a floor-plan picker component

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
