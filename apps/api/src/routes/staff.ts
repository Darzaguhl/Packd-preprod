import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const VALID_STAFF_ROLES = ['fronthost'] as const
type StaffRole = typeof VALID_STAFF_ROLES[number]

interface SupabaseAppMeta {
  role?: string
  studioIds?: string[]
}

/** Fetch current app_metadata for a Supabase user. */
async function getSupabaseAppMeta(userId: string): Promise<SupabaseAppMeta> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  })
  if (!res.ok) return {}
  const data = await res.json() as { app_metadata?: SupabaseAppMeta }
  return data.app_metadata ?? {}
}

/** Overwrite a Supabase user's app_metadata. */
async function setSupabaseAppMeta(userId: string, meta: SupabaseAppMeta): Promise<void> {
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

async function assertStudioAccess(
  userId: string,
  role: string,
  studioId: string,
  jwtStudioIds?: string[],
): Promise<boolean> {
  if (ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']) return true
  // Check JWT studioIds first (no DB roundtrip for staff)
  if (jwtStudioIds && jwtStudioIds.length > 0) return jwtStudioIds.includes(studioId)
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  return !!(member && member.studioId === studioId)
}

export async function staffRoutes(app: FastifyInstance) {
  // GET /staff/studios — studios assigned to the current user (fronthost use)
  app.get(
    '/studios',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = getUser(request)
      const ids = user.studioIds ?? []
      if (ids.length === 0) return reply.send([])
      const studios = await prisma.studio.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, timezone: true },
        orderBy: { name: 'asc' },
      })
      return reply.send(studios)
    },
  )

  // GET /staff?studioId= — list all staff members for a studio
  app.get<{ Querystring: { studioId: string } }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, user.studioIds)) return reply.forbidden()

      const staff = await prisma.member.findMany({
        where: { studioId, staffRole: { not: null } },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
      })

      return staff.map(s => ({
        id: s.id,
        userId: s.userId,
        name: `${s.user.firstName} ${s.user.lastName}`,
        email: s.user.email,
        staffRole: s.staffRole,
        joinedAt: s.joinedAt.toISOString(),
      }))
    },
  )

  // POST /staff — assign a staff role to an existing user
  // Appends studioId to the user's studioIds array in Supabase app_metadata.
  app.post<{ Body: { studioId: string; email: string; staffRole: string } }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, email, staffRole } = request.body
      if (!studioId || !email || !staffRole) {
        return reply.badRequest('studioId, email, and staffRole are required')
      }
      if (!VALID_STAFF_ROLES.includes(staffRole as StaffRole)) {
        return reply.badRequest(`staffRole must be one of: ${VALID_STAFF_ROLES.join(', ')}`)
      }

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, user.studioIds)) return reply.forbidden()

      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      const targetUser = await prisma.user.findUnique({ where: { email } })
      if (!targetUser) {
        return reply.notFound('No account found with that email address. The user must sign up first.')
      }

      // Merge new studioId into existing studioIds array
      const current = await getSupabaseAppMeta(targetUser.id)
      const existingIds: string[] = current.studioIds ?? []
      const newIds = [...new Set([...existingIds, studioId])]

      await setSupabaseAppMeta(targetUser.id, { role: staffRole, studioIds: newIds })

      // Upsert Member record for the primary (first) studio so the user appears in StaffTab
      const primaryStudioId = newIds[0]
      const existing = await prisma.member.findUnique({ where: { userId: targetUser.id } })
      if (existing) {
        await prisma.member.update({
          where: { userId: targetUser.id },
          // Update studioId only if this is their first assignment
          data: { studioId: existing.studioId === primaryStudioId ? existing.studioId : primaryStudioId, staffRole },
        })
      } else {
        await prisma.member.create({
          data: { userId: targetUser.id, studioId: primaryStudioId, staffRole, source: 'packd' },
        })
      }

      return reply.send({ success: true, studioIds: newIds })
    },
  )

  // DELETE /staff/:memberId — remove this studio from the user's assignments.
  // If no studios remain, reverts role to 'member'.
  app.delete<{ Params: { memberId: string }; Querystring: { studioId?: string } }>(
    '/:memberId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { memberId } = request.params
      const callerStudioId = request.query.studioId

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        include: { user: { select: { id: true, email: true } } },
      })
      if (!member) return reply.notFound()

      const user = getUser(request)
      const studioToRemove = callerStudioId ?? member.studioId
      if (!await assertStudioAccess(user.id, user.role, studioToRemove, user.studioIds)) return reply.forbidden()

      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      const current = await getSupabaseAppMeta(member.user.id)
      const remaining = (current.studioIds ?? [member.studioId]).filter(id => id !== studioToRemove)

      if (remaining.length === 0) {
        // No more studios — fully revoke staff role
        await setSupabaseAppMeta(member.user.id, { role: 'member', studioIds: [] })
        await prisma.member.update({ where: { id: memberId }, data: { staffRole: null } })
      } else {
        // Still assigned to other studios — keep role, update studioIds
        await setSupabaseAppMeta(member.user.id, { role: current.role ?? member.staffRole!, studioIds: remaining })
        // Update Member record to point to their next primary studio
        await prisma.member.update({
          where: { id: memberId },
          data: { studioId: remaining[0], staffRole: member.staffRole },
        })
      }

      return reply.send({ success: true, remainingStudios: remaining.length })
    },
  )
}
