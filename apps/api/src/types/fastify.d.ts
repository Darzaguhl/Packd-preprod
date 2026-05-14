import type { AuthUser } from '@packd/types'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser
  }
}
