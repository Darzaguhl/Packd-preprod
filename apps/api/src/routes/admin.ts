import type { FastifyInstance } from 'fastify'
import { adminSessionRoutes }   from './admin-sessions.js'
import { adminMembersRoutes }   from './admin-members.js'
import { adminAnalyticsRoutes } from './admin-analytics.js'
import { adminSalesRoutes }     from './admin-sales.js'
import { adminExportsRoutes }   from './admin-exports.js'

export async function adminRoutes(app: FastifyInstance) {
  await app.register(adminSessionRoutes)
  await app.register(adminMembersRoutes)
  await app.register(adminAnalyticsRoutes)
  await app.register(adminSalesRoutes)
  await app.register(adminExportsRoutes)
}
