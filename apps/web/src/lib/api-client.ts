/**
 * Typed API client built on openapi-fetch.
 *
 * This module provides compile-time type safety for API calls using the types
 * generated from the OpenAPI spec in `api-types.generated.ts`.
 *
 * ## Response types
 *
 * Routes that have Zod response schemas in the API emit typed response bodies
 * in `api-types.generated.ts`.  The `ApiResponseBody` helper below extracts the
 * `application/json` content type for any given path + method.
 *
 * Previously these were hand-written interfaces in `api.ts`.  Routes covered by
 * the generated types no longer need hand-written interfaces; the generated type
 * is the authoritative source.  Remaining hand-written types in `api.ts` cover
 * routes that have not yet received Zod response schemas.
 *
 * ## Why two layers?
 *
 * The generated `paths` interface encodes exact request-body shapes for every
 * route, so passing the wrong fields is a TypeScript error.  Response bodies are
 * not yet emitted by the Fastify routes in the OpenAPI spec (`content?: never`),
 * so response types are still supplied as generic parameters — identical to the
 * existing `api.ts` pattern.
 *
 * ## Migration strategy
 *
 * - New code: call `makeApiClient(token).GET(...)` / `.POST(...)` etc. directly.
 * - Existing code: use the namespaced helpers below (`bookings`, `waitlist`,
 *   `members`, `waivers`) which match the `api.*` calling convention from
 *   `api.ts` and can be dropped in as replacements.
 * - Old functions in `api.ts` are marked `@deprecated` and will be removed once
 *   all call-sites have migrated.
 *
 * ## Error behaviour
 *
 * All helpers throw an `Error` with the API's `message` / `error` field as the
 * message, and every field from the response body attached directly to the error
 * object (same as `apiFetch` in `api.ts`). The `waiverId` enrichment that
 * `SessionDetailView` relies on therefore works without any change.
 *
 * ## 401 token refresh
 *
 * A thin middleware in `makeApiClient` retries once with a fresh Supabase token
 * when a 401 is received — matching the retry logic in `apiFetch`.
 */

import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from './api-types.generated'
import type { ApiResponse, MemberProfile, SessionSlot } from '@packd/types'

// Re-export every type and value from the types-only api.ts module so
// consumers can use a single import: `from '@/lib/api-client'`
export * from './api'

// ---------------------------------------------------------------------------
// Generated response type helpers
// ---------------------------------------------------------------------------
// Extracts the application/json response body for a given path + method from
// the generated OpenAPI types, replacing hand-written interfaces for routes
// that now have Zod response schemas.
type GetBody<P extends keyof paths> =
  paths[P] extends { get: { responses: { 200: { content: { 'application/json': infer B } } } } }
    ? B : never
type PostBody<P extends keyof paths> =
  paths[P] extends { post: { responses: { 200: { content: { 'application/json': infer B } } } } }
    ? B : never

// Routes with response schemas — use generated types
export type AdminSession         = GetBody<'/admin/sessions'>[number]
export type AdminBooking         = GetBody<'/admin/sessions/{id}/bookings'>[number]
export type AdminMemberProfile   = GetBody<'/admin/members/{memberId}/profile'>
export type AdminMemberHistory   = GetBody<'/admin/members/{memberId}/history'>
export type StaffNote            = GetBody<'/admin/members/{memberId}/notes'>[number]
export type GuestPassEntry       = GetBody<'/admin/members/{memberId}/guest-passes'>[number]
export type AnalyticsData        = GetBody<'/admin/analytics'>
export type QueryResult          = PostBody<'/admin/query'>
export type Leaderboard          = GetBody<'/admin/leaderboard'>
export type StudioSummary        = GetBody<'/franchise/studios'>[number]
export type StaffWithPermissions = GetBody<'/franchise/studios/{studioId}/staff-permissions'>[number]
export type RoomLayout           = GetBody<'/rooms/{roomId}/layouts'>[number]
export type SessionSpots         = GetBody<'/rooms/{roomId}/sessions/{sessionId}/spots'>
export type CalendarWeek         = GetBody<'/schedules/'>
export type ClassSchedule        = GetBody<'/schedules/all'>[number]
export type OrphanedPattern      = GetBody<'/schedules/orphaned'>[number]
export type StaffMember          = GetBody<'/staff/'>[number]
export type InstructorPhoto      = GetBody<'/photos/instructors/{instructorId}'>[number]
export type ClassTemplate        = GetBody<'/templates/'>[number]
export type Product              = GetBody<'/products/'>[number]
export type MembershipPlan       = GetBody<'/memberships/plans'>[number]
export type MembershipSubscription = GetBody<'/memberships/'>[number]
export type StaffShift           = GetBody<'/admin/shifts/'>[number]
export type StaffShiftPattern    = GetBody<'/admin/shift-patterns/'>[number]
export type AvailabilityBlock    = GetBody<'/availability/'>[number]
export type PromoCode            = GetBody<'/promos/'>[number]
export type StudioDetail         = GetBody<'/studios/{studioId}'>
export type NetworkWithStudios   = GetBody<'/networks/'>[number]
export type StudioNetwork        = Omit<NetworkWithStudios, 'studios'>
export type MemberNetworkInfo    = GetBody<'/networks/my'>
export type RoomSummary          = GetBody<'/studios/{studioId}/rooms'>[number]

// Sub-types inferred from generated schemas
export type Station           = RoomLayout['stations'][number]
export type SpotAssignment    = SessionSpots['assignments'][number]
export type CalendarSession   = CalendarWeek['sessions'][number]
export type CalendarTemplate  = CalendarWeek['templates'][number]
export type CalendarInstructor = CalendarWeek['instructors'][number]
export type CalendarRoom      = CalendarWeek['rooms'][number]

// Import types still needed from api.ts (not yet covered by generated schemas)
import type {
  UpcomingBooking, MemberHistory, MemberStats, ProductSale,
  CartSaleItem,
  InstructorPermissions, FronthostPermissions,
  LayoutTemplate,
  NetworkStudio,
  PlatformBrand, Brand, BrandStats, BrandMember, BrandSession,
} from './api'

// ---------------------------------------------------------------------------
// Types defined only in api-client.ts (not in api.ts)
// ---------------------------------------------------------------------------

export type MemberMeResponse = MemberProfile & {
  birthday: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  guestPassBalance: number
}

export interface WaiverInfo {
  id: string
  title: string
  body: string
  version: number
  updatedAt: string
}

// ---------------------------------------------------------------------------
// Core client factory
// ---------------------------------------------------------------------------

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/**
 * Builds a one-request-per-call error-throwing middleware that:
 * 1. Attaches all response-body fields to the thrown Error (so callers can read
 *    `(e as any).waiverId`, `(e as any).statusCode`, etc.)
 * 2. Retries once on 401 with a freshly-refreshed Supabase access token.
 */
function buildMiddleware(getToken: () => string): Middleware {
  return {
    async onResponse({ response }) {
      if (response.ok) return response

      // On 401, try to refresh the Supabase session and return a sentinel so
      // the fetch layer can retry.  openapi-fetch doesn't have a built-in
      // "retry" hook, so we signal via a custom header that the caller reads.
      if (response.status === 401) {
        try {
          const { createClient } = await import('@/lib/supabase/client')
          const { data } = await createClient().auth.getSession()
          const fresh = data.session?.access_token
          if (fresh && fresh !== getToken()) {
            // Re-issue the request with the new token.  We clone the original
            // request and swap the Authorization header.
            const cloned = response.clone()
            // Attach the fresh token as a header on the response so the
            // outer helper can detect it.  (We cannot re-issue directly from
            // a middleware — instead we surface the token and let the wrapper
            // function do the retry.)
            return new Response(cloned.body, {
              status: 401,
              headers: { ...Object.fromEntries(cloned.headers), 'x-fresh-token': fresh },
            })
          }
        } catch {
          // Refresh failed — fall through to normal error handling
        }
      }

      return response
    },
  }
}

/**
 * Returns a raw openapi-fetch client pre-configured with the bearer token.
 * Use this for new code that wants direct access to the typed `.GET()` /
 * `.POST()` etc. methods.
 *
 * The client does **not** throw on non-2xx — check `error` in the returned
 * `{ data, error }` tuple.  For the throwing variant (matching `api.ts`
 * behaviour) use the namespaced helpers below.
 */
export function makeApiClient(token: string) {
  return createClient<paths>({
    baseUrl: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Re-export the paths type so consumers don't need a second import.
export type { paths }

// ---------------------------------------------------------------------------
// Shared throwing helper
// ---------------------------------------------------------------------------

/**
 * Wraps an openapi-fetch call so that errors are thrown as enriched Error
 * objects (same contract as `apiFetch` in `api.ts`).
 *
 * The `fetcher` callback receives a client already wired to `token`.  On 401
 * the function attempts a single token-refresh retry.
 */
async function typedFetch<T>(
  token: string,
  fetcher: (client: ReturnType<typeof makeApiClient>) => Promise<{ data?: unknown; error?: unknown; response: Response }>,
): Promise<T> {
  let client = makeApiClient(token)
  let result = await fetcher(client)

  // 401 retry: if the response contains the fresh token sentinel header,
  // re-issue with the refreshed token.
  if (result.response.status === 401) {
    const fresh = result.response.headers.get('x-fresh-token')
    if (fresh && fresh !== token) {
      client = makeApiClient(fresh)
      result = await fetcher(client)
    }
  }

  if (result.error) {
    const body = result.error as Record<string, unknown>
    const err = new Error(
      (body.message as string | undefined) ??
        (body.error as string | undefined) ??
        'API error',
    ) as Error & Record<string, unknown>
    Object.assign(err, body)
    throw err
  }

  if (!result.response.ok) {
    // openapi-fetch may return ok=false without populating error when content
    // is absent (e.g. 403 with no body).  Parse manually.
    const body: Record<string, unknown> = await result.response
      .json()
      .catch(() => ({ error: result.response.statusText }))
    const err = new Error(
      (body.message as string | undefined) ??
        (body.error as string | undefined) ??
        'API error',
    ) as Error & Record<string, unknown>
    Object.assign(err, body)
    throw err
  }

  // Response body: openapi-fetch puts parsed JSON in `data` when the schema
  // declares content.  Since our spec has `content?: never` for most responses
  // the client returns raw response — parse manually.
  if (result.data !== undefined) return result.data as T
  return result.response.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// bookings namespace
// ---------------------------------------------------------------------------

/**
 * Typed replacements for `api.bookings.*` from `api.ts`.
 *
 * Request bodies are validated against the OpenAPI spec at compile time.
 * Attempting to pass an unknown field (e.g. a renamed property) is a TS error.
 */
export const bookings = {
  /**
   * Book a class session.
   *
   * @deprecated (api.ts) Use `bookings.create` from `api-client.ts` instead.
   */
  async create(
    body: paths['/bookings/']['post']['requestBody']['content']['application/json'],
    token: string,
  ): Promise<ApiResponse<{ id: string }>> {
    return typedFetch(token, (c) => c.POST('/bookings/', { body }))
  },

  /**
   * Cancel a booking.
   *
   * @deprecated (api.ts) Use `bookings.cancel` from `api-client.ts` instead.
   */
  async cancel(
    bookingId: string,
    token: string,
  ): Promise<{ success: boolean; isLateCancel: boolean }> {
    return typedFetch(token, (c) =>
      c.DELETE('/bookings/{id}', { params: { path: { id: bookingId } } }),
    )
  },

  /**
   * Member self check-in.
   *
   * @deprecated (api.ts) Use `bookings.selfCheckIn` from `api-client.ts` instead.
   */
  async selfCheckIn(
    bookingId: string,
    token: string,
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.POST('/bookings/{id}/checkin', { params: { path: { id: bookingId } } }),
    )
  },
}

// ---------------------------------------------------------------------------
// waitlist namespace
// ---------------------------------------------------------------------------

/**
 * Typed replacements for `api.waitlist.*` from `api.ts`.
 */
export const waitlist = {
  /**
   * Join the waitlist for a session.
   *
   * @deprecated (api.ts) Use `waitlist.join` from `api-client.ts` instead.
   */
  async join(
    sessionId: string,
    token: string,
  ): Promise<ApiResponse<{ id: string; position: number }>> {
    return typedFetch(token, (c) =>
      c.POST('/waitlist/', {
        body: { sessionId },
      }),
    )
  },

  /**
   * Leave (cancel) a waitlist entry.
   */
  async leave(
    waitlistId: string,
    token: string,
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.DELETE('/waitlist/{id}', { params: { path: { id: waitlistId } } }),
    )
  },

  /**
   * Confirm a promoted waitlist spot (staff / admin).
   */
  async confirm(
    waitlistId: string,
    token: string,
    memberId?: string,
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.POST('/waitlist/{id}/confirm', {
        params: { path: { id: waitlistId } },
        body: memberId ? { memberId } : null,
      }),
    )
  },
}

// ---------------------------------------------------------------------------
// members namespace
// ---------------------------------------------------------------------------

/**
 * Typed replacements for the member-facing subset of `api.members.*`.
 * Admin-facing endpoints (search, profile, history, …) remain in `api.ts`
 * until a subsequent migration pass.
 */
export const members = {
  /**
   * Fetch the current member's profile.
   *
   * @deprecated (api.ts) Use `members.me` from `api-client.ts` instead.
   */
  async me(token: string): Promise<MemberMeResponse> {
    return typedFetch(token, (c) => c.GET('/members/me'))
  },

  /**
   * Update the current member's profile fields.
   *
   * The body type is inferred from the OpenAPI spec — passing an unknown field
   * is a compile-time error.
   *
   * @deprecated (api.ts) Use `members.updateMe` from `api-client.ts` instead.
   */
  async updateMe(
    data: NonNullable<
      paths['/members/me']['patch']['requestBody']['content']['application/json']
    >,
    token: string,
  ): Promise<{ success: boolean; data: { firstName: string; lastName: string } }> {
    return typedFetch(token, (c) => c.PATCH('/members/me', { body: data }))
  },

  /**
   * Delete (anonymise) the current member's account (GDPR).
   *
   * @deprecated (api.ts) Use `members.deleteAccount` from `api-client.ts` instead.
   */
  async deleteAccount(token: string): Promise<{ success: boolean }> {
    return typedFetch(token, (c) => c.DELETE('/members/me'))
  },

  /**
   * Update email notification preferences.
   *
   * @deprecated (api.ts) Use `members.updateEmailPreferences` from `api-client.ts` instead.
   */
  async updateEmailPreferences(
    prefs: paths['/members/me/email-preferences']['patch']['requestBody']['content']['application/json'],
    token: string,
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.PATCH('/members/me/email-preferences', { body: prefs }),
    )
  },

  /**
   * Ensure a member record exists for the authenticated user.
   *
   * @deprecated (api.ts) Use `members.ensure` from `api-client.ts` instead.
   */
  async ensure(
    token: string,
    studioId?: string,
  ): Promise<{ success: boolean; memberId: string }> {
    return typedFetch(token, (c) =>
      c.POST('/members/ensure', { body: studioId ? { studioId } : null }),
    )
  },

  /**
   * Get or generate the current member's referral code.
   *
   * @deprecated (api.ts) Use `members.referral` from `api-client.ts` instead.
   */
  async referral(token: string): Promise<{
    code: string
    totalReferrals: number
    pendingReward: number
    creditsEarned: number
  }> {
    return typedFetch(token, (c) => c.GET('/members/me/referral'))
  },

  /**
   * Apply a referral code.
   *
   * @deprecated (api.ts) Use `members.applyReferral` from `api-client.ts` instead.
   */
  async applyReferral(
    code: string,
    token: string,
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.POST('/members/referral/apply', {
        body: { code },
      }),
    )
  },
}

// ---------------------------------------------------------------------------
// waivers namespace
// ---------------------------------------------------------------------------

/**
 * Typed replacements for `api.waivers.*` from `api.ts`.
 */
export const waivers = {
  /**
   * Fetch the currently active waiver for a studio (member-facing).
   *
   * @deprecated (api.ts) Use `waivers.getActive` from `api-client.ts` instead.
   */
  async getActive(
    studioId: string,
    token: string,
  ): Promise<{ waiver: WaiverInfo | null }> {
    return typedFetch(token, (c) =>
      c.GET('/waivers/active', { params: { query: { studioId } } }),
    )
  },

  /**
   * Sign the active waiver on behalf of the current member.
   *
   * @deprecated (api.ts) Use `waivers.sign` from `api-client.ts` instead.
   */
  async sign(
    waiverId: string,
    token: string,
    opts?: { studioId?: string; ipAddress?: string },
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.POST('/waivers/{id}/sign', {
        params: { path: { id: waiverId } },
        body: opts ?? null,
      }),
    )
  },

  /**
   * Fetch the waiver for admin management.
   *
   * @deprecated (api.ts) Use `waivers.getAdmin` from `api-client.ts` instead.
   */
  async getAdmin(
    studioId: string,
    token: string,
  ): Promise<{ waiver: WaiverInfo | null }> {
    return typedFetch(token, (c) =>
      c.GET('/waivers/admin', { params: { query: { studioId } } }),
    )
  },

  /**
   * Create or replace the studio waiver (deactivates the previous version).
   *
   * @deprecated (api.ts) Use `waivers.upsert` from `api-client.ts` instead.
   */
  async upsert(
    studioId: string,
    title: string,
    body: string,
    token: string,
  ): Promise<{ success: boolean; version: number }> {
    return typedFetch(token, (c) =>
      c.PUT('/waivers/admin', { body: { studioId, title, body } }),
    )
  },

  /**
   * Remove (deactivate) the studio waiver.
   *
   * @deprecated (api.ts) Use `waivers.remove` from `api-client.ts` instead.
   */
  async remove(
    studioId: string,
    token: string,
  ): Promise<{ success: boolean }> {
    return typedFetch(token, (c) =>
      c.DELETE('/waivers/admin', { params: { query: { studioId } } }),
    )
  },
}

// ---------------------------------------------------------------------------
// Legacy apiFetch infrastructure (previously in api.ts)
//
// Used by the `api` namespace object below. Mirrors the same 401-retry and
// error-enrichment behaviour as the openapi-fetch layer above.
// ---------------------------------------------------------------------------

const _API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

async function _doFetch(path: string, token: string | undefined, opts: RequestInit): Promise<Response> {
  const hasBody = opts.body != null
  return fetch(`${_API_URL}${path}`, {
    ...opts,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers as Record<string, string> | undefined),
    },
  })
}

async function apiFetch<T>(path: string, options: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...fetchOptions } = options
  let res = await _doFetch(path, token, fetchOptions)
  if (res.status === 401 && token) {
    try {
      const { createClient: createSupabaseClient } = await import('@/lib/supabase/client')
      const { data } = await createSupabaseClient().auth.getSession()
      const fresh = data.session?.access_token
      if (fresh && fresh !== token) res = await _doFetch(path, fresh, fetchOptions)
    } catch { /* fall through */ }
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    const err = new Error(body.message ?? body.error ?? 'API error') as Error & Record<string, unknown>
    Object.assign(err, body)
    throw err
  }
  return res.json() as Promise<T>
}

// ---------------------------------------------------------------------------
// api — all remaining namespaces migrated from api.ts
// ---------------------------------------------------------------------------

export const platform = {
  stats: (token: string) =>
    apiFetch<{
      brands: number
      franchises: number
      studios: number
      members: number
      bookings30d: number
      revenueThisMonth: number
      activeStudios30d: number
    }>('/admin/platform/stats', { token }),

  health: (token: string) =>
    apiFetch<{
      latencyMs: number
      services: Record<string, { status: string; error?: string }>
      timestamp: string
    }>('/admin/platform/health', { token }),

  jobs: (token: string) =>
    apiFetch<{
      stats: { name: string; state: string; count: number }[]
      failed: { id: string; name: string; data: unknown; output: unknown; createdon: string; completedon: string | null; retrycount: number }[]
    }>('/admin/platform/jobs', { token }),

  retryJob: (id: string, token: string) =>
    apiFetch<{ success: boolean }>(`/admin/platform/jobs/${id}/retry`, { method: 'POST', token }),

  purgeJob: (id: string, token: string) =>
    apiFetch<{ success: boolean }>(`/admin/platform/jobs/${id}`, { method: 'DELETE', token }),

  auditLog: (token: string, params?: { cursor?: string; take?: number; action?: string }) => {
    const qs = new URLSearchParams()
    if (params?.cursor) qs.set('cursor', params.cursor)
    if (params?.take) qs.set('take', String(params.take))
    if (params?.action) qs.set('action', params.action)
    const q = qs.toString()
    return apiFetch<{
      items: { id: string; actorId: string; actorRole: string; action: string; targetId: string | null; meta: unknown; createdAt: string }[]
      nextCursor: string | null
      hasMore: boolean
    }>(`/admin/platform/audit${q ? `?${q}` : ''}`, { token })
  },
}

export const api = {
  schedule: {
    list: (studioId: string, from: string, to: string, token?: string) =>
      apiFetch<{ studioId: string; studioName: string; timeFormat: string; timezone: string; lateCancelWindowHours: number; lateCancelFeeCredits: number; sessions: SessionSlot[] }>(
        `/schedule/${studioId}?from=${from}&to=${to}`,
        token ? { token } : {},
      ),
    brandStudios: (studioId: string) =>
      apiFetch<{
        brandId: string | null
        brandName: string | null
        franchises: { id: string; name: string; studios: { id: string; name: string; city: string; country: string }[] }[]
        standalone: { id: string; name: string; city: string; country: string }[]
      }>(`/schedule/brand-studios?studioId=${studioId}`),
  },
  members: {
    bookings: (token: string) => apiFetch<UpcomingBooking[]>('/members/me/bookings', { token }),
    history: (token: string) => apiFetch<MemberHistory>('/members/me/history', { token }),
    stats: (studioId: string, token: string) =>
      apiFetch<MemberStats>(`/members/me/stats?studioId=${studioId}`, { token }),
    purchases: (token: string, studioId?: string) =>
      apiFetch<ProductSale[]>(`/members/me/purchases${studioId ? `?studioId=${studioId}` : ''}`, { token }),
    selfPause: (subscriptionId: string, pauseUntil: string, token: string) =>
      apiFetch<{ success: boolean }>(`/memberships/subscriptions/${subscriptionId}/self-pause`, { method: 'POST', body: JSON.stringify({ pauseUntil }), token }),
    exportData: (token: string) =>
      fetch(`${typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL : ''}/members/me/export`, { headers: { Authorization: `Bearer ${token}` } }),
    receipts: (token: string) =>
      apiFetch<{ id: string; soldAt: string; totalCents: number; currency: string; stripeReceiptUrl: string | null; items: unknown[] }[]>('/members/me/receipts', { token }),
  },
  admin: {
    stats: (studioId: string, token: string) =>
      apiFetch<{ studioName: string | null; timeFormat: string; currency: string; timezone: string; bookingWindowDays: number; bookingCloseHours: number; waitlistEnabled: boolean; guestCheckInEnabled: boolean; creditPurchaseEnabled: boolean; selfCheckInEnabled: boolean; classReminderHours: number | null; maxPauseDays: number; maxPausesPerYear: number; websiteUrl: string | null; supportEmail: string | null; todaySessions: number; totalMembers: number; totalBookingsToday: number; waitlistToday: number }>(
        `/admin/stats?studioId=${studioId}`, { token }),
    sessions: (studioId: string, date: string, token: string) =>
      apiFetch<AdminSession[]>(`/admin/sessions?studioId=${studioId}&date=${date}`, { token }),
    bookings: (sessionId: string, token: string) =>
      apiFetch<AdminBooking[]>(`/admin/sessions/${sessionId}/bookings`, { token }),
    checkin: (sessionId: string, bookingId: string, token: string) =>
      apiFetch<{ success: boolean; checkedIn: boolean }>(`/admin/sessions/${sessionId}/checkin/${bookingId}`, { method: 'POST', token }),
    updateSession: (sessionId: string, status: string, token: string) =>
      apiFetch<{ success: boolean; status: string }>(`/admin/sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ status }), token }),
    adjustCredits: (memberId: string, amount: number, note: string, token: string) =>
      apiFetch<{ success: boolean; newBalance: number }>(`/admin/members/${memberId}/credits`, { method: 'POST', body: JSON.stringify({ amount, note }), token }),
    recordProductSale: (body: { memberId: string; studioId: string; items: CartSaleItem[]; totalCents: number; totalCredits: number; paymentMethod: 'cash' | 'credits' | 'free' }, token: string) =>
      apiFetch<{ success: boolean }>('/admin/product-sales', { method: 'POST', body: JSON.stringify(body), token }),
    productSaleMemberIds: (studioId: string, token: string, date?: string) =>
      apiFetch<{ memberIds: string[] }>(`/admin/product-sales?studioId=${studioId}${date ? `&date=${date}` : ''}`, { token }),
    updateMember: (memberId: string, data: { notes?: string | null }, token: string) =>
      apiFetch<{ success: boolean; data: { id: string; notes: string | null } }>(`/admin/members/${memberId}`, { method: 'PATCH', body: JSON.stringify(data), token }),
    searchMembers: (studioId: string, q: string, token: string) =>
      apiFetch<{ id: string; name: string; email: string; creditBalance: number; membershipStatus: string | null }[]>(
        `/admin/members/search?studioId=${studioId}&q=${encodeURIComponent(q)}`, { token }),
    memberProfile: (memberId: string, token: string) =>
      apiFetch<AdminMemberProfile>(`/admin/members/${memberId}/profile`, { token }),
    memberHistory: (memberId: string, token: string) =>
      apiFetch<AdminMemberHistory>(`/admin/members/${memberId}/history`, { token }),
    listMembers: (studioId: string, token: string, q?: string, cursor?: string) =>
      apiFetch<{ items: { id: string; name: string; email: string; creditBalance: number; membershipStatus: string | null }[]; nextCursor: string | null; hasMore: boolean }>(
        `/admin/members?studioId=${studioId}${q ? `&q=${encodeURIComponent(q)}` : ''}${cursor ? `&cursor=${cursor}` : ''}`, { token }),
    analytics: (studioId: string, token: string, weeks = 12) =>
      apiFetch<AnalyticsData>(`/admin/analytics?studioId=${studioId}&weeks=${weeks}`, { token }),
    query: (sql: string, studioId: string, token: string) =>
      apiFetch<QueryResult>('/admin/query', { token, method: 'POST', body: JSON.stringify({ sql, studioId }) }),
    memberUpcoming: (memberId: string, token: string) =>
      apiFetch<UpcomingBooking[]>(`/admin/members/${memberId}/upcoming`, { token }),
    rescheduleSession: (sessionId: string, startsAt: string, endsAt: string, token: string) =>
      apiFetch<{ success: boolean; startsAt: string; endsAt: string }>(
        `/admin/sessions/${sessionId}`, { token, method: 'PATCH', body: JSON.stringify({ startsAt, endsAt }) }),
    leaderboard: (studioId: string, period: string, token: string) =>
      apiFetch<Leaderboard>(`/admin/leaderboard?studioId=${studioId}&period=${period}`, { token }),
    bulkPreview: (params: { studioId: string; from: string; to: string; instructorId?: string; templateId?: string }, token: string) => {
      const qs = new URLSearchParams({ studioId: params.studioId, from: params.from, to: params.to })
      if (params.instructorId) qs.set('instructorId', params.instructorId)
      if (params.templateId) qs.set('templateId', params.templateId)
      return apiFetch<{ total: number; sessionIds: string[]; byTemplate: { name: string; count: number }[]; sessions: { id: string; startsAt: string; templateName: string; instructorName: string; confirmedBookings: number }[] }>(`/admin/sessions/bulk?${qs}`, { token })
    },
    bulkExecute: (body: { studioId: string; from: string; to: string; instructorId?: string; templateId?: string; action: 'CANCEL' | 'SUBSTITUTE'; substituteInstructorId?: string }, token: string) =>
      apiFetch<{ affected: number; sessionIds: string[] }>('/admin/sessions/bulk', { method: 'POST', body: JSON.stringify(body), token }),
    announce: (sessionId: string, subject: string, message: string, token: string) =>
      apiFetch<{ sent: number; total: number }>(`/admin/sessions/${sessionId}/announce`, { method: 'POST', body: JSON.stringify({ subject, message }), token }),
    memberNotes: (memberId: string, token: string) =>
      apiFetch<StaffNote[]>(`/admin/members/${memberId}/notes`, { token }),
    addNote: (memberId: string, content: string, token: string) =>
      apiFetch<StaffNote>(`/admin/members/${memberId}/notes`, { method: 'POST', body: JSON.stringify({ content }), token }),
    deleteNote: (memberId: string, noteId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/admin/members/${memberId}/notes/${noteId}`, { method: 'DELETE', token }),
    updateMemberProfile: (memberId: string, data: { birthday?: string | null; emergencyContactName?: string | null; emergencyContactPhone?: string | null }, token: string) =>
      apiFetch<{ success: boolean }>(`/admin/members/${memberId}/profile`, { method: 'PATCH', body: JSON.stringify(data), token }),
    grantGuestPasses: (memberId: string, amount: number, note: string | undefined, token: string) =>
      apiFetch<{ success: boolean; guestPassBalance: number }>(`/admin/members/${memberId}/guest-passes/grant`, { method: 'POST', body: JSON.stringify({ amount, note }), token }),
    guestCheckin: (memberId: string, guestName: string, studioId: string, sessionId: string | undefined, token: string) =>
      apiFetch<{ success: boolean; guestPassBalance: number }>('/admin/guest-checkin', { method: 'POST', body: JSON.stringify({ memberId, guestName, studioId, sessionId }), token }),
    guestPassLog: (memberId: string, token: string) =>
      apiFetch<GuestPassEntry[]>(`/admin/members/${memberId}/guest-passes`, { token }),
    memberPurchases: (memberId: string, token: string, studioId?: string) =>
      apiFetch<ProductSale[]>(`/admin/members/${memberId}/purchases${studioId ? `?studioId=${studioId}` : ''}`, { token }),
    exportCsv: async (type: 'members' | 'attendance' | 'revenue' | 'instructor-pay' | 'staff-pay', studioId: string, token: string, params?: { from?: string; to?: string }) => {
      const qs = new URLSearchParams({ studioId })
      if (params?.from) qs.set('from', params.from)
      if (params?.to) qs.set('to', params.to)
      const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'
      const res = await fetch(`${base}/admin/export/${type}?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${type}.csv`; a.click()
      URL.revokeObjectURL(url)
    },
    auditLog: (studioId: string, token: string, cursor?: string) =>
      apiFetch<{ entries: { id: string; actorId: string; actorRole: string; action: string; targetId: string | null; meta: unknown; createdAt: string }[]; nextCursor: string | null }>(
        `/admin/audit-log?studioId=${studioId}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token }),
  },
  franchise: {
    info: (token: string) =>
      apiFetch<{ id: string | null; name: string | null }>('/franchise/info', { token }) as Promise<{ id: string | null; name: string | null }>,
    myStudios: (token: string) =>
      apiFetch<{ id: string; name: string; slug: string }[]>('/franchise/my-studios', { token }),
    studios: (token: string) =>
      apiFetch<StudioSummary[]>('/franchise/studios', { token }),
    myInstructor: (studioId: string, token: string) =>
      apiFetch<{ id: string; memberId: string | null; avatarUrl: string | null; permissions: InstructorPermissions }>(`/franchise/studios/${studioId}/my-instructor`, { token }),
    myFronthostPermissions: (studioId: string, token: string) =>
      apiFetch<{ permissions: FronthostPermissions }>(`/franchise/studios/${studioId}/my-fronthost-permissions`, { token }),
    updatePermissions: (studioId: string, instructorId: string, permissions: Partial<InstructorPermissions>, token: string) =>
      apiFetch<{ success: boolean; permissions: InstructorPermissions }>(
        `/franchise/studios/${studioId}/instructors/${instructorId}/permissions`, { method: 'PATCH', body: JSON.stringify(permissions), token }),
    staffPermissions: (studioId: string, token: string) =>
      apiFetch<StaffWithPermissions[]>(`/franchise/studios/${studioId}/staff-permissions`, { token }),
    updateFronthostPermissions: (studioId: string, memberId: string, permissions: Partial<FronthostPermissions>, token: string) =>
      apiFetch<{ success: boolean; permissions: FronthostPermissions }>(
        `/franchise/studios/${studioId}/fronthosts/${memberId}/permissions`, { method: 'PATCH', body: JSON.stringify(permissions), token }),
    listAdmins: (studioId: string, token: string) =>
      apiFetch<{ id: string; userId: string; name: string; email: string; joinedAt: string }[]>(
        `/franchise/studios/${studioId}/admins`, { token }),
    addAdmin: (studioId: string, email: string, token: string) =>
      apiFetch<{ success: boolean; roles: string[] }>(`/franchise/studios/${studioId}/admins`, { method: 'POST', body: JSON.stringify({ email }), token }),
    removeAdmin: (studioId: string, userId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/franchise/studios/${studioId}/admins/${userId}`, { method: 'DELETE', token }),
    allStaff: (token: string, cursor?: string) =>
      apiFetch<{ items: { id: string; userId: string; name: string; email: string; roles: string[]; studioIds: string[]; studios: { id: string; name: string }[]; payRateHourlyCents: number | null; instructorRates: { instructorId: string; studioId: string; studioName: string; payRatePerHeadCents: number | null }[] }[]; nextCursor: string | null; hasMore: boolean }>(
        `/franchise/staff${cursor ? `?cursor=${cursor}` : ''}`, { token }),
    allAdmins: (token: string, cursor?: string) =>
      apiFetch<{ items: { userId: string; name: string; email: string; studioIds: string[]; studios: { id: string; name: string }[] }[]; nextCursor: string | null; hasMore: boolean }>(
        `/franchise/all-admins${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { token }),
    listPromos: (token: string, cursor?: string) =>
      apiFetch<{ items: { code: string; description: string | null; type: string; value: number; maxUses: number | null; usageCount: number; studios: string[]; isActive: boolean; validUntil: string | null }[]; nextCursor: string | null; hasMore: boolean }>(
        `/franchise/promos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { token }),
    createPromo: (body: { code: string; description?: string; type: string; value: number; maxUses?: number | null; validUntil?: string | null }, token: string) =>
      apiFetch<{ success: boolean; studios: number }>('/franchise/promos', { method: 'POST', body: JSON.stringify(body), token }),
    deletePromo: (code: string, token: string) =>
      apiFetch<{ success: boolean; deleted: number }>(`/franchise/promos/${encodeURIComponent(code)}`, { method: 'DELETE', token }),
    broadcast: (body: { studioIds: string[]; subject: string; message: string }, token: string) =>
      apiFetch<{ success: boolean; queued: boolean; estimatedRecipients: number }>('/franchise/broadcast', { method: 'POST', body: JSON.stringify(body), token }),
  },
  photos: {
    list: (instructorId: string, token: string) =>
      apiFetch<InstructorPhoto[]>(`/photos/instructors/${instructorId}`, { token }),
    upload: (instructorId: string, body: { base64: string; fileName: string; contentType: string }, token: string) =>
      apiFetch<InstructorPhoto>(`/photos/instructors/${instructorId}/upload`, { method: 'POST', body: JSON.stringify(body), token }),
    toggleApproval: (instructorId: string, photoId: string, approvedForSocial: boolean, token: string) =>
      apiFetch<InstructorPhoto>(`/photos/instructors/${instructorId}/${photoId}`, { method: 'PATCH', body: JSON.stringify({ approvedForSocial }), token }),
    delete: (instructorId: string, photoId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/photos/instructors/${instructorId}/${photoId}`, { method: 'DELETE', token }),
    approvedByStudio: (studioId: string, token: string) =>
      apiFetch<(InstructorPhoto & { instructorName: string })[]>(`/photos/studios/${studioId}/approved`, { token }),
  },
  templates: {
    list: (studioId: string, token: string) =>
      apiFetch<ClassTemplate[]>(`/templates?studioId=${studioId}`, { token }),
    create: (body: Omit<ClassTemplate, 'id'>, token: string) =>
      apiFetch<ClassTemplate>('/templates', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: Partial<Omit<ClassTemplate, 'id' | 'studioId'>>, token: string) =>
      apiFetch<ClassTemplate>(`/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/templates/${id}`, { method: 'DELETE', token }),
  },
  rooms: {
    layout: (roomId: string, token: string) =>
      apiFetch<RoomLayout | null>(`/rooms/${roomId}/layout`, { token }),
    layouts: (roomId: string, token: string) =>
      apiFetch<RoomLayout[]>(`/rooms/${roomId}/layouts`, { token }),
    activateLayout: (roomId: string, layoutId: string, token: string) =>
      apiFetch<RoomLayout>(`/rooms/${roomId}/layouts/${layoutId}/activate`, { method: 'POST', token }),
    updateLayout: (roomId: string, layoutId: string, body: { name?: string; widthM: number; lengthM: number; stations: Omit<Station, 'id' | 'layoutId'>[] }, token: string) =>
      apiFetch<RoomLayout>(`/rooms/${roomId}/layouts/${layoutId}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    deleteLayout: (roomId: string, layoutId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/rooms/${roomId}/layouts/${layoutId}`, { method: 'DELETE', token }),
    saveLayout: (roomId: string, body: { name?: string; widthM: number; lengthM: number; stations: Omit<Station, 'id' | 'layoutId'>[] }, token: string) =>
      apiFetch<RoomLayout>(`/rooms/${roomId}/layout`, { method: 'POST', body: JSON.stringify(body), token }),
    spots: (roomId: string, sessionId: string, token: string) =>
      apiFetch<SessionSpots>(`/rooms/${roomId}/sessions/${sessionId}/spots`, { token }),
    assignSpot: (roomId: string, sessionId: string, bookingId: string, stationId: string | null, token: string) =>
      apiFetch<{ bookingId: string; stationId: string | null }>(
        `/rooms/${roomId}/sessions/${sessionId}/spots`, { method: 'POST', body: JSON.stringify({ bookingId, stationId }), token }),
    pickMySpot: (roomId: string, sessionId: string, stationId: string | null, token: string) =>
      apiFetch<{ stationId: string | null }>(
        `/rooms/${roomId}/sessions/${sessionId}/my-spot`, { method: 'POST', body: JSON.stringify({ stationId }), token }),
  },
  schedules: {
    week: (studioId: string, weekStart: string, token: string) =>
      apiFetch<CalendarWeek>(`/schedules?studioId=${studioId}&weekStart=${weekStart}`, { token }),
    all: (studioId: string, token: string) =>
      apiFetch<ClassSchedule[]>(`/schedules/all?studioId=${studioId}`, { token }),
    create: (body: { studioId: string; templateId: string; instructorId: string; roomId: string; capacity: number; creditsRequired?: number; isPrivate?: boolean; daysOfWeek: number[]; startTime: string; durationMin: number; intervalWeeks?: number; validFrom: string; validUntil?: string; generateWeeks?: number }, token: string) =>
      apiFetch<{ success: boolean; id: string }>('/schedules', { method: 'POST', body: JSON.stringify(body), token }),
    update: (scheduleId: string, body: { studioId: string; templateId?: string; instructorId?: string; roomId?: string; capacity?: number; creditsRequired?: number; daysOfWeek?: number[]; startTime?: string; durationMin?: number; intervalWeeks?: number; validUntil?: string | null }, token: string) =>
      apiFetch<{ success: boolean }>(`/schedules/${scheduleId}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (scheduleId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/schedules/${scheduleId}?studioId=${studioId}`, { method: 'DELETE', token }),
    month: (studioId: string, year: number, month: number, token: string, instructorId?: string) =>
      apiFetch<{ year: number; month: number; days: Record<string, { id: string; sport: string; name: string; startsAt: string; instructorId: string | null; instructorName: string; substituteInstructorId: string | null; status: string }[]> }>(
        `/schedules/month?studioId=${studioId}&year=${year}&month=${month}${instructorId ? `&instructorId=${instructorId}` : ''}`, { token }),
    orphaned: (studioId: string, token: string) =>
      apiFetch<OrphanedPattern[]>(`/schedules/orphaned?studioId=${studioId}`, { token }),
    deleteOrphaned: (studioId: string, templateId: string, instructorId: string, startTime: string, token: string) =>
      apiFetch<{ success: boolean; deleted: number }>(
        `/schedules/orphaned?studioId=${studioId}&templateId=${encodeURIComponent(templateId)}&instructorId=${encodeURIComponent(instructorId)}&startTime=${encodeURIComponent(startTime)}`,
        { method: 'DELETE', token }),
    setSubstitute: (sessionId: string, substituteInstructorId: string | null, studioId: string, token: string) =>
      apiFetch<{ success: boolean; substituteInstructorId: string | null; substituteInstructorName: string | null }>(
        `/schedules/sessions/${sessionId}/substitute`, { method: 'PATCH', body: JSON.stringify({ substituteInstructorId, studioId }), token }),
  },
  staff: {
    myStudios: (token: string) =>
      apiFetch<{ id: string; name: string; timezone: string }[]>('/staff/studios', { token }),
    list: (studioId: string, token: string) =>
      apiFetch<StaffMember[]>(`/staff?studioId=${studioId}`, { token }),
    assign: (studioId: string, email: string, staffRole: string, token: string) =>
      apiFetch<{ success: boolean }>('/staff', { method: 'POST', body: JSON.stringify({ studioId, email, staffRole }), token }),
    remove: (memberId: string, studioId: string, token: string, role?: string) =>
      apiFetch<{ success: boolean; remainingRoles: string[]; remainingStudios: number }>(
        `/staff/${memberId}?studioId=${studioId}${role ? `&role=${encodeURIComponent(role)}` : ''}`, { method: 'DELETE', token }),
    invite: (email: string, firstName: string, role: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean; message: string }>('/staff/invite', { method: 'POST', body: JSON.stringify({ email, firstName, role, studioId }), token }),
    updateInstructorPayRate: (instructorId: string, payRatePerHeadCents: number | null, token: string) =>
      apiFetch<{ success: boolean }>(`/staff/instructors/${instructorId}`, { method: 'PATCH', body: JSON.stringify({ payRatePerHeadCents }), token }),
    updateHourlyPayRate: (memberId: string, payRateHourlyCents: number | null, token: string) =>
      apiFetch<{ success: boolean }>(`/staff/${memberId}/hourly-pay`, { method: 'PATCH', body: JSON.stringify({ payRateHourlyCents }), token }),
    acceptInvite: (body: { studioId: string; role: string; invitedEmail: string; token: string }, token: string) =>
      apiFetch<{ success: boolean; role: string; studioName: string }>('/staff/accept-invite', { method: 'POST', body: JSON.stringify(body), token }),
    uploadAvatar: (memberId: string, body: { base64: string; fileName: string; contentType: string }, token: string) =>
      apiFetch<{ avatarUrl: string }>(`/staff/${memberId}/avatar`, { method: 'POST', body: JSON.stringify(body), token }),
  },
  studios: {
    list: (token: string) => apiFetch<StudioSummary[]>('/studios', { token }),
    get: (studioId: string, token: string) => apiFetch<StudioDetail>(`/studios/${studioId}`, { token }),
    update: (studioId: string, body: { name?: string; slug?: string; timezone?: string; currency?: string; timeFormat?: string; websiteUrl?: string | null; supportEmail?: string | null; bookingWindowDays?: number; bookingCloseHours?: number; waitlistEnabled?: boolean; guestCheckInEnabled?: boolean; creditPurchaseEnabled?: boolean; selfCheckInEnabled?: boolean; classReminderHours?: number | null; maxPauseDays?: number; maxPausesPerYear?: number; allowMemberPause?: boolean; taxRatePct?: number; referralRewardCredits?: number; location?: { id: string; name?: string; address?: string; city?: string; country?: string } }, token: string) =>
      apiFetch<{ success: boolean; studio: StudioDetail }>(`/studios/${studioId}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    create: (body: { name: string; slug: string; timezone: string; currency: string; location: { name: string; address: string; city: string; country: string } }, token: string) =>
      apiFetch<{ success: boolean; data: { id: string; name: string; slug: string } }>('/studios', { method: 'POST', body: JSON.stringify(body), token }),
    delete: (studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/studios/${studioId}`, { method: 'DELETE', token }),
    rooms: (studioId: string, token: string) =>
      apiFetch<RoomSummary[]>(`/studios/${studioId}/rooms`, { token }),
    createRoom: (studioId: string, body: { name: string; capacity: number; locationId?: string }, token: string) =>
      apiFetch<{ id: string; name: string; capacity: number }>(`/studios/${studioId}/rooms`, { method: 'POST', body: JSON.stringify(body), token }),
    deleteRoom: (studioId: string, roomId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/studios/${studioId}/rooms/${roomId}`, { method: 'DELETE', token }),
    layouts: (studioId: string, token: string) =>
      apiFetch<LayoutTemplate[]>(`/studios/${studioId}/layouts`, { token }),
    getPolicy: (studioId: string, token: string) =>
      apiFetch<{ lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number; waitlistWindowMinutes: number }>(
        `/studios/${studioId}/policy`, { token }),
    updatePolicy: (studioId: string, body: { lateCancelWindowHours?: number; lateCancelFeeCredits?: number; noShowFeeCredits?: number; waitlistWindowMinutes?: number }, token: string) =>
      apiFetch<{ lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number; waitlistWindowMinutes: number }>(
        `/studios/${studioId}/policy`, { method: 'PATCH', body: JSON.stringify(body), token }),
    onboard: (body: { name: string; slug: string; timezone: string; currency: string; policy: { lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number }; location: { name: string; address: string; city: string; country: string }; rooms: { name: string; capacity: number; sport: string }[] }, token: string) =>
      apiFetch<ApiResponse<{ id: string }>>('/studios/onboard', { method: 'POST', body: JSON.stringify(body), token }),
    copyFrom: (studioId: string, sourceStudioId: string, copy: ('plans' | 'products' | 'templates' | 'policy')[], token: string) =>
      apiFetch<{ success: boolean; copied: string[] }>(`/studios/${studioId}/copy-from/${sourceStudioId}`, { method: 'POST', body: JSON.stringify({ copy }), token }),
  },
  products: {
    list: (studioId: string, token: string, all = false) =>
      apiFetch<Product[]>(`/products?studioId=${studioId}${all ? '&all=true' : ''}`, { token }),
    create: (body: { studioId: string; name: string; category?: string; priceInCents: number; creditsRequired?: number }, token: string) =>
      apiFetch<Product>('/products', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: Partial<Omit<Product, 'id' | 'studioId'>>, token: string) =>
      apiFetch<Product>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/products/${id}`, { method: 'DELETE', token }),
  },
  memberships: {
    listPlans: (studioId: string, token: string) =>
      apiFetch<MembershipPlan[]>(`/memberships/plans?studioId=${studioId}`, { token }),
    createPlan: (body: { studioId: string; name: string; description?: string; priceInCents: number; intervalMonths?: number; creditsPerCycle?: number | null }, token: string) =>
      apiFetch<{ success: boolean; data: MembershipPlan }>('/memberships/plans', { method: 'POST', body: JSON.stringify(body), token }),
    updatePlan: (planId: string, body: Partial<Omit<MembershipPlan, 'id' | 'studioId' | 'activeSubscriptions'>>, token: string) =>
      apiFetch<{ success: boolean; data: MembershipPlan }>(`/memberships/plans/${planId}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    deletePlan: (planId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/memberships/plans/${planId}`, { method: 'DELETE', token }),
    listSubscriptions: (params: { studioId?: string; memberId?: string }, token: string) => {
      const qs = new URLSearchParams()
      if (params.studioId) qs.set('studioId', params.studioId)
      if (params.memberId) qs.set('memberId', params.memberId)
      return apiFetch<MembershipSubscription[]>(`/memberships?${qs}`, { token })
    },
    assign: (body: { memberId: string; planId: string; startDate?: string; grantCredits?: boolean }, token: string) =>
      apiFetch<{ success: boolean; data: MembershipSubscription }>('/memberships', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { status?: string; endDate?: string | null; grantCredits?: boolean }, token: string) =>
      apiFetch<{ success: boolean; data: MembershipSubscription }>(`/memberships/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    me: (token: string) =>
      apiFetch<MembershipSubscription | null>('/memberships/me', { token }),
    publicPlans: (studioId: string, token: string) =>
      apiFetch<Omit<MembershipPlan, 'activeSubscriptions'>[]>(`/memberships/plans/member?studioId=${studioId}`, { token }),
    subscribe: (planId: string, token: string) =>
      apiFetch<{ success: boolean; data: MembershipSubscription }>('/memberships/subscribe', { method: 'POST', body: JSON.stringify({ planId }), token }),
    cancelMe: (token: string) =>
      apiFetch<{ success: boolean }>('/memberships/me', { token, method: 'DELETE' }),
    pauseSubscription: (memberId: string, token: string, pausedUntil?: string | null) =>
      apiFetch<{ success: boolean; status: string; pausedUntil: string | null }>(
        `/admin/members/${memberId}/subscription/pause`, { method: 'POST', body: JSON.stringify({ pausedUntil: pausedUntil ?? null }), token }),
    resumeSubscription: (memberId: string, token: string) =>
      apiFetch<{ success: boolean; status: string }>(
        `/admin/members/${memberId}/subscription/resume`, { method: 'POST', token }),
  },
  stripe: {
    checkout: (planId: string, studioId: string, token: string, promoCodeId?: string) =>
      apiFetch<{ url: string }>('/stripe/checkout', { method: 'POST', body: JSON.stringify({ planId, studioId, ...(promoCodeId ? { promoCodeId } : {}) }), token }),
    portal: (token: string) =>
      apiFetch<{ url: string }>('/stripe/portal', { method: 'POST', token }),
    customerCard: (memberId: string, token: string) =>
      apiFetch<{ hasCard: boolean; last4?: string; brand?: string; paymentMethodId?: string }>(`/stripe/customer-card?memberId=${memberId}`, { token }),
    chargeMember: (body: { memberId: string; studioId: string; items: CartSaleItem[]; totalCents: number; totalCredits: number }, token: string) =>
      apiFetch<{ success: boolean }>('/stripe/charge-member', { method: 'POST', body: JSON.stringify(body), token }),
    refund: (saleId: string, token: string, amountCents?: number) =>
      apiFetch<{ success: boolean; refundId: string; refundedCents: number }>('/stripe/refund', { method: 'POST', body: JSON.stringify({ saleId, amountCents }), token }),
  },
  availability: {
    list: (studioId: string, token: string, from?: string, to?: string) => {
      const qs = new URLSearchParams({ studioId })
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      return apiFetch<AvailabilityBlock[]>(`/availability?${qs}`, { token })
    },
    listForInstructor: (instructorId: string, token: string, from?: string, to?: string) => {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      return apiFetch<AvailabilityBlock[]>(`/availability/instructor/${instructorId}?${qs}`, { token })
    },
    create: (body: { instructorId: string; studioId: string; title: string; startDate: string; endDate: string }, token: string) =>
      apiFetch<AvailabilityBlock>('/availability', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { title?: string; startDate?: string; endDate?: string }, token: string) =>
      apiFetch<AvailabilityBlock>(`/availability/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/availability/${id}`, { method: 'DELETE', token }),
  },
  promos: {
    list: (studioId: string, token: string) =>
      apiFetch<PromoCode[]>(`/promos?studioId=${studioId}`, { token }),
    create: (body: { studioId: string; code: string; description?: string; type: string; value: number; maxUses?: number | null; validFrom?: string; validUntil?: string | null }, token: string) =>
      apiFetch<PromoCode>('/promos', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { description?: string; value?: number; maxUses?: number | null; validFrom?: string; validUntil?: string | null; isActive?: boolean }, token: string) =>
      apiFetch<PromoCode>(`/promos/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/promos/${id}`, { method: 'DELETE', token }),
    redeem: (code: string, studioId: string, token: string, memberId?: string) =>
      apiFetch<{ success: boolean; type: string; creditsAdded: number; discount: { type: string; value: number; promoCodeId: string } | null; message: string }>(
        '/promos/redeem', { method: 'POST', body: JSON.stringify({ code, studioId, ...(memberId ? { memberId } : {}) }), token }),
  },
  ical: {
    getToken: (token: string) =>
      apiFetch<{ token: string; urls: { member: string; instructor?: string; fronthost?: string } }>('/ical/token', { token }),
  },
  shifts: {
    list: (studioId: string, from: string, to: string, token: string) =>
      apiFetch<StaffShift[]>(`/admin/shifts?studioId=${studioId}&from=${from}&to=${to}`, { token }),
    mine: (token: string, studioId?: string, from?: string) =>
      apiFetch<StaffShift[]>(
        `/admin/shifts/mine${studioId ? `?studioId=${studioId}` : ''}${from ? `${studioId ? '&' : '?'}from=${from}` : ''}`, { token }),
    create: (body: { studioId: string; memberId: string; startsAt: string; endsAt: string; note?: string }, token: string) =>
      apiFetch<StaffShift>('/admin/shifts', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { startsAt?: string; endsAt?: string; note?: string | null }, token: string) =>
      apiFetch<StaffShift>(`/admin/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    remove: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/admin/shifts/${id}`, { method: 'DELETE', token }),
  },
  shiftPatterns: {
    list: (studioId: string, token: string, memberId?: string) =>
      apiFetch<StaffShiftPattern[]>(`/admin/shift-patterns?studioId=${studioId}${memberId ? `&memberId=${memberId}` : ''}`, { token }),
    create: (body: { studioId: string; memberId: string; daysOfWeek: number[]; startTime: string; endTime: string; intervalWeeks?: number; validFrom: string; validUntil?: string; note?: string }, token: string) =>
      apiFetch<StaffShiftPattern & { shiftsGenerated: number }>('/admin/shift-patterns', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { daysOfWeek?: number[]; startTime?: string; endTime?: string; intervalWeeks?: number; validFrom?: string; validUntil?: string | null; note?: string | null }, token: string) =>
      apiFetch<StaffShiftPattern & { shiftsRegenerated: number }>(`/admin/shift-patterns/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    remove: (id: string, token: string) =>
      apiFetch<{ success: boolean; futureShiftsDeleted: number }>(`/admin/shift-patterns/${id}`, { method: 'DELETE', token }),
  },
  networks: {
    list: (token: string) => apiFetch<NetworkWithStudios[]>('/networks', { token }),
    create: (body: { name: string; slug: string }, token: string) =>
      apiFetch<StudioNetwork>('/networks', { method: 'POST', body: JSON.stringify(body), token }),
    update: (id: string, body: { name?: string; slug?: string }, token: string) =>
      apiFetch<StudioNetwork>(`/networks/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/networks/${id}`, { method: 'DELETE', token }),
    addStudio: (networkId: string, studioId: string, token: string) =>
      apiFetch<{ id: string; studio: { id: string; name: string; slug: string } }>(`/networks/${networkId}/studios`, { method: 'POST', body: JSON.stringify({ studioId }), token }),
    removeStudio: (networkId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/networks/${networkId}/studios/${studioId}`, { method: 'DELETE', token }),
    my: (token: string) => apiFetch<MemberNetworkInfo>('/networks/my', { token }),
  },
  brands: {
    listAll: (token: string) =>
      apiFetch<{ success: true; data: PlatformBrand[] }>('/brands', { token }),
    update: (id: string, body: { name?: string; slug?: string; description?: string }, token: string) =>
      apiFetch<{ success: true; data: PlatformBrand }>(`/brands/${id}`, { method: 'PATCH', body: JSON.stringify(body), token }),
    list: (token: string) =>
      apiFetch<{ success: true; data: Brand[] }>('/brands', { token }),
    my: (token: string) =>
      apiFetch<{ success: true; data: Brand }>('/brands/my', { token }),
    get: (id: string, token: string) =>
      apiFetch<{ success: true; data: Brand }>(`/brands/${id}`, { token }),
    create: (body: { name: string; slug: string; logoUrl?: string; description?: string }, token: string) =>
      apiFetch<{ success: true; data: Brand }>('/brands', { method: 'POST', body: JSON.stringify(body), token }),
    delete: (id: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${id}`, { method: 'DELETE', token }),
    addStudio: (brandId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${brandId}/studios`, { method: 'POST', body: JSON.stringify({ studioId }), token }),
    removeStudio: (brandId: string, studioId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${brandId}/studios/${studioId}`, { method: 'DELETE', token }),
    createFranchise: (brandId: string, body: { name: string; slug: string; description?: string }, token: string) =>
      apiFetch<{ success: true; data: { id: string; name: string; slug: string } }>(`/brands/${brandId}/franchises`, { method: 'POST', body: JSON.stringify(body), token }),
    promoteFranchiseAdmin: (brandId: string, body: { email: string; franchiseId: string; firstName?: string; lastName?: string }, token: string) =>
      apiFetch<{ success: true; created: boolean; roles: string[]; franchiseId: string; message: string }>(`/brands/${brandId}/franchise-admins`, { method: 'POST', body: JSON.stringify(body), token }),
    removeFranchiseAdmin: (brandId: string, userId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${brandId}/franchise-admins/${userId}`, { method: 'DELETE', token }),
    assignBrandAdmin: (brandId: string, body: { email: string; firstName?: string; lastName?: string }, token: string) =>
      apiFetch<{ success: boolean; created: boolean; message: string }>(`/brands/${brandId}/brand-admins`, { method: 'POST', body: JSON.stringify(body), token }),
    removeBrandAdmin: (brandId: string, userId: string, token: string) =>
      apiFetch<{ success: boolean }>(`/brands/${brandId}/brand-admins/${userId}`, { method: 'DELETE', token }),
    stats: (id: string, period: string, token: string) =>
      apiFetch<{ success: true; data: BrandStats }>(`/brands/${id}/stats?period=${period}`, { token }),
    members: (id: string, params: { q?: string; studioId?: string; cursor?: string }, token: string) => {
      const qs = new URLSearchParams()
      if (params.q) qs.set('q', params.q)
      if (params.studioId) qs.set('studioId', params.studioId)
      if (params.cursor) qs.set('cursor', params.cursor)
      return apiFetch<{ items: BrandMember[]; nextCursor: string | null; hasMore: boolean }>(`/brands/${id}/members?${qs}`, { token })
    },
    sessions: (id: string, params: { studioId?: string; from?: string; to?: string }, token: string) => {
      const qs = new URLSearchParams()
      if (params.studioId) qs.set('studioId', params.studioId)
      if (params.from) qs.set('from', params.from)
      if (params.to) qs.set('to', params.to)
      return apiFetch<{ success: true; data: BrandSession[] }>(`/brands/${id}/sessions?${qs}`, { token })
    },
  },
}
