import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const VALID_STAFF_ROLES = ['fronthost'] as const
type StaffRole = typeof VALID_STAFF_ROLES[number]

/** Update a Supabase user's app_metadata (role + optional studioId). */
async function setSupabaseAppMeta(
  userId: string,
  meta: { role: string; studioId?: string | null },
): Promise<void> {
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
): Promise<boolean> {
  if (ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']) return true
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  return !!(member && member.studioId === studioId)
}

export async function staffRoutes(app: FastifyInstance) {
  // GET /staff?studioId= — list all staff members for a studio
  app.get<{ Querystring: { studioId: string } }>(
    '/',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId)) return reply.forbidden()

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
  // Body: { studioId, email, staffRole }
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
      if (!await assertStudioAccess(user.id, user.role, studioId)) return reply.forbidden()

      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      // Find the user in our DB by email
      const targetUser = await prisma.user.findUnique({ where: { email } })
      if (!targetUser) {
        return reply.notFound('No account found with that email address. The user must sign up first.')
      }

      // Update Supabase app_metadata — carries the role + studioId into every JWT
      await setSupabaseAppMeta(targetUser.id, { role: staffRole, studioId })

      // Create or update a Member record so staff appear in the studio's member list
      // and so assertStudioAccess (Member-lookup path) works as a fallback.
      const existing = await prisma.member.findUnique({ where: { userId: targetUser.id } })
      if (existing) {
        await prisma.member.update({
          where: { userId: targetUser.id },
          data: { studioId, staffRole },
        })
      } else {
        await prisma.member.create({
          data: {
            userId: targetUser.id,
            studioId,
            staffRole,
            source: 'packd',
          },
        })
      }

      return reply.send({ success: true })
    },
  )

  // DELETE /staff/:memberId — revoke staff role, revert to regular member
  app.delete<{ Params: { memberId: string } }>(
    '/:memberId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { memberId } = request.params

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        include: { user: { select: { id: true, email: true } } },
      })
      if (!member) return reply.notFound()

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, member.studioId)) return reply.forbidden()

      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      // Revert Supabase role to 'member' and clear studioId from app_metadata
      await setSupabaseAppMeta(member.user.id, { role: 'member', studioId: null })

      // Clear staffRole — keep the Member record in case they were also a regular member
      await prisma.member.update({
        where: { id: memberId },
        data: { staffRole: null },
      })

      return reply.send({ success: true })
    },
  )
}
