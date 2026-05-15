import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AuthUser } from '@packd/types'

const SUPABASE_URL = process.env.SUPABASE_URL!
const JWKS = createRemoteJWKSet(
  new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`),
)

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing token' })
  }

  const token = authHeader.slice(7)
  try {
    const { payload } = await jwtVerify(token, JWKS)

    // Fix #3: role MUST come from app_metadata (server-controlled) only.
    // user_metadata is writable by the client and must never grant elevated access.
    const rawRole = (payload.app_metadata as { role?: string } | undefined)?.role
    const role: AuthUser['role'] = rawRole === 'admin' || rawRole === 'studio_admin' || rawRole === 'instructor'
      ? rawRole
      : 'client'

    request.user = {
      id: payload.sub!,
      email: payload.email as string,
      role,
    } satisfies AuthUser
  } catch {
    return reply.code(401).send({ error: 'Invalid token' })
  }
}

export function getUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser
}
