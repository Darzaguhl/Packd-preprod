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
    request.user = {
      id: payload.sub!,
      email: payload.email as string,
      role: (payload.user_metadata as { role?: string })?.role ?? 'client',
    } satisfies AuthUser
  } catch {
    return reply.code(401).send({ error: 'Invalid token' })
  }
}

export function getUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser
}
