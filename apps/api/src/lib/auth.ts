import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { ROLE_RANK, type AuthUser, type UserRole } from '@packd/types'

const SUPABASE_URL = process.env.SUPABASE_URL!
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
)

const ELEVATED_ROLES = new Set<string>(['admin', 'franchise_admin', 'studio_admin', 'instructor', 'fronthost'])

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing token' })
  }

  const token = authHeader.slice(7)
  try {
    const { payload } = await jwtVerify(token, JWKS)

    // Role MUST come from app_metadata (server-controlled).
    // user_metadata is writable by the client and must never grant elevated access.
    const appMeta = payload.app_metadata as { role?: string; roles?: string[]; studioId?: string; studioIds?: string[] } | undefined
    const rawRole = appMeta?.role
    const role: UserRole = ELEVATED_ROLES.has(rawRole ?? '') ? (rawRole as UserRole) : 'member'

    // All assigned roles (for dashboard routing); fall back to [role] if roles array not yet set
    const roles: string[] = appMeta?.roles ?? (role !== 'member' ? [role] : [])

    // Support both legacy singular studioId and new studioIds array
    const studioIds: string[] = appMeta?.studioIds ?? (appMeta?.studioId ? [appMeta.studioId] : [])
    const studioId = studioIds[0]

    request.user = {
      id: payload.sub!,
      email: payload.email as string,
      role,
      roles,
      studioId,
      studioIds,
    } satisfies AuthUser
  } catch {
    return reply.code(401).send({ error: 'Invalid token' })
  }
}

/** Returns a Fastify preHandler that requires the user's role to be >= minRole in the hierarchy. */
export function requireRole(minRole: UserRole) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await requireAuth(request, reply)
    if (reply.sent) return
    const user = getUser(request)
    if (ROLE_RANK[user.role] < ROLE_RANK[minRole]) {
      return reply.forbidden(`Requires ${minRole} role or higher`)
    }
  }
}

export function getUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser
}
