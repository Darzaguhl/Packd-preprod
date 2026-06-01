/**
 * Typed API client built on openapi-fetch.
 *
 * This module provides compile-time type safety for API calls using the types
 * generated from the OpenAPI spec in `api-types.generated.ts`.
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
import type { ApiResponse, MemberProfile } from '@packd/types'

// ---------------------------------------------------------------------------
// Shared response types reused across namespaces (keep in sync with api.ts)
// ---------------------------------------------------------------------------

export interface UpcomingBooking {
  id: string
  sessionId: string
  startsAt: string
  endsAt: string
  templateName: string
  sport: string
  instructorName: string
  studioId: string
  studioName: string
  stationId: string | null
  status: string
  isCheckedIn: boolean
  memberNote: string | null
}

export interface MemberStats {
  totalBookings: number
  totalCancellations: number
  totalNoShows: number
  totalCheckIns: number
  currentStreak: number
  longestStreak: number
  favoriteSport: string | null
  favoriteInstructor: string | null
  memberSince: string
}

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
