const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ── Shared Supabase user list (cached 60s) ────────────────────────────────────

export interface SbUser {
  id: string
  email: string
  created_at?: string
  app_metadata?: SupabaseAppMeta & Record<string, unknown>
  user_metadata?: Record<string, unknown>
}

let _sbUsersCache: { ts: number; users: SbUser[] } | null = null
const SB_USERS_TTL_MS = 60_000

/** Fetch all Supabase auth users, paginating through every page. Cached 60s. */
export async function fetchSupabaseUsers(): Promise<SbUser[]> {
  const now = Date.now()
  if (_sbUsersCache && now - _sbUsersCache.ts < SB_USERS_TTL_MS) return _sbUsersCache.users
  const PAGE_SIZE = 1000
  let page = 1
  const users: SbUser[] = []
  while (true) {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=${PAGE_SIZE}&page=${page}`,
      { headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY } },
    )
    const data = await res.json() as { users?: SbUser[] }
    const batch = data.users ?? []
    users.push(...batch)
    if (batch.length < PAGE_SIZE) break
    page++
  }
  _sbUsersCache = { ts: now, users }
  return users
}

/** Invalidate the user-list cache (call after any role change). */
export function invalidateSupabaseUsersCache() {
  _sbUsersCache = null
}


/** Create a new Supabase auth user (email confirmed, no password — must use reset-password flow). */
export async function createSupabaseUser(
  email: string,
  meta?: SupabaseAppMeta,
): Promise<{ id: string; email: string }> {
  const body: Record<string, unknown> = {
    email,
    email_confirm: true,   // skip email-verification step
  }
  if (meta) body.app_metadata = meta

  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Supabase create-user error: ${(err as { message?: string }).message ?? res.statusText}`)
  }

  const data = await res.json() as { id: string; email: string }
  return data
}

export interface SupabaseAppMeta {
  role?: string
  roles?: string[]      // all assigned roles (e.g. ['studio_admin', 'instructor'] for multi-role)
  studioIds?: string[]
  franchiseId?: string  // set for franchise_admin users
  brandId?: string      // set for brand_admin users
}

/** Fetch current app_metadata for a Supabase user. */
export async function getSupabaseAppMeta(userId: string): Promise<SupabaseAppMeta> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  })
  if (!res.ok) return {}
  const data = await res.json() as { app_metadata?: SupabaseAppMeta }
  return data.app_metadata ?? {}
}

/** Overwrite a Supabase user's app_metadata. */
export async function setSupabaseAppMeta(userId: string, meta: SupabaseAppMeta): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ app_metadata: meta }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Supabase Admin API error: ${(err as { message?: string }).message ?? res.statusText}`)
  }
}

/**
 * Generate a password-setup (recovery) link for a user via the Supabase admin API.
 * Use this when creating a new admin account — include the link in an invite email
 * so they can set their password without going through "Forgot password" manually.
 */
export async function generatePasswordSetupLink(email: string, redirectTo: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'recovery', email, options: { redirectTo } }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`generate_link error: ${(err as { message?: string }).message ?? res.statusText}`)
  }
  const data = await res.json() as { action_link?: string }
  if (!data.action_link) throw new Error('No action_link returned from Supabase')
  return data.action_link
}

/**
 * Revoke all active sessions for a Supabase user.
 *
 * Call this immediately after modifying app_metadata (role changes, removals)
 * so the user's current JWT is invalidated and they must re-authenticate to
 * receive a token that reflects the updated role. Failure is non-fatal — the
 * role change in app_metadata is the authoritative truth; at worst the old
 * session persists until the JWT naturally expires (~1 hour).
 */
export async function revokeUserSessions(userId: string): Promise<void> {
  // Supabase Admin API: DELETE /auth/v1/admin/users/:id/logout
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  })
  // 404 = no active sessions, still fine
  if (!res.ok && res.status !== 404) {
    console.warn(`[supabase-admin] revokeUserSessions failed for ${userId}: ${res.status}`)
  }
}

/**
 * Derive the primary role from a set of roles.
 * Highest-rank role wins: franchise_admin > studio_admin > instructor > fronthost > member
 */
export function getPrimaryRole(roles: string[]): string {
  const PRIORITY = ['admin', 'brand_admin', 'franchise_admin', 'studio_admin', 'instructor', 'fronthost']
  for (const r of PRIORITY) {
    if (roles.includes(r)) return r
  }
  return 'member'
}
