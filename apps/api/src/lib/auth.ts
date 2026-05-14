import type { FastifyRequest, FastifyReply } from 'fastify'
import type { AuthUser } from '@packd/types'

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    reply.unauthorized('Invalid or missing token')
  }
}

export function getUser(request: FastifyRequest): AuthUser {
  return request.user as AuthUser
}
