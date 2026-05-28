const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!


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
