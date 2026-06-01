/**
 * Fastify plugin: automatic studio-access enforcement
 *
 * Instead of calling assertStudioAccess() manually in every handler,
 * routes declare WHERE the studioId comes from via route config:
 *
 *   app.get('/admin/members', {
 *     config: { studioIdFrom: 'querystring' },
 *     preHandler: requireStudioAdmin,
 *     schema: { querystring: z.object({ studioId: z.string() }) },
 *   }, handler)
 *
 * The plugin injects a preHandler that:
 *  1. Extracts studioId from the declared source
 *  2. Calls assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)
 *  3. Returns early (reply already sent) on failure
 *
 * Routes that need custom logic (studioId derived from DB, cross-resource
 * ownership checks) keep their manual assertStudioAccess call and omit
 * config.studioIdFrom.
 *
 * Supported sources:
 *   'querystring' — request.query.studioId
 *   'params'      — request.params.studioId
 *   'body'        — request.body.studioId
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, RouteOptions } from 'fastify'
import fp from 'fastify-plugin'
import { getUser } from './auth.js'
import { assertStudioAccess } from '../routes/admin-shared.js'

export type StudioIdSource = 'querystring' | 'params' | 'body'

declare module 'fastify' {
  interface FastifyContextConfig {
    studioIdFrom?: StudioIdSource
  }
}

function extractStudioId(request: FastifyRequest, source: StudioIdSource): string | undefined {
  switch (source) {
    case 'querystring': return (request.query as Record<string, string>).studioId
    case 'params':      return (request.params as Record<string, string>).studioId
    case 'body':        return (request.body as Record<string, string> | null)?.studioId
  }
}

async function studioAccessGuard(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const source = request.routeOptions?.config?.studioIdFrom
  if (!source) return                             // route opted out — no automatic check

  const studioId = extractStudioId(request, source)
  if (!studioId) {
    return reply.badRequest('studioId is required')
  }

  const user = getUser(request)
  await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)
}

/**
 * Register the plugin. After registration, any route with
 * `config: { studioIdFrom: ... }` gets automatic studio-access validation
 * injected as the last preHandler (runs after requireAuth/requireRole).
 */
export const studioAccessPlugin = fp(async (app: FastifyInstance) => {
  app.addHook('onRoute', (routeOptions: RouteOptions) => {
    if (!routeOptions.config?.studioIdFrom) return

    // Normalise preHandler to an array and append the guard
    const existing = routeOptions.preHandler
    const handlers = existing
      ? (Array.isArray(existing) ? existing : [existing])
      : []

    routeOptions.preHandler = [...handlers, studioAccessGuard]
  })
})
