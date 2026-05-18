import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, requireAuth, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const VALID_STAFF_ROLES = ['fronthost', 'instructor'] as const
type StaffRole = typeof VALID_STAFF_ROLES[number]

interface SupabaseAppMeta {
  role?: string
  roles?: string[]    // all assigned roles (e.g. ['instructor','fronthost'] for dual-role)
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
        where: { studioIds: { has: studioId }, staffRoles: { hasSome: [...VALID_STAFF_ROLES] } },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
        orderBy: { joinedAt: 'asc' },
      })

      return staff.map(s => ({
        id: s.id,
        userId: s.userId,
        name: `${s.user.firstName} ${s.user.lastName}`,
        email: s.user.email,
        staffRoles: s.staffRoles,
        joinedAt: s.joinedAt.toISOString(),
      }))
    },
  )

  // POST /staff — add a role to an existing user for this studio (additive — does not replace existing roles)
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

      // Merge new role into existing roles (additive — supports dual fronthost+instructor)
      const existingRoles: string[] = current.roles ?? (current.role && current.role !== 'member' ? [current.role] : [])
      const newRoles = [...new Set([...existingRoles, staffRole])]
      // Primary role for auth: prefer instructor (has Instructor record), otherwise first role
      const primaryRole = newRoles.includes('instructor') ? 'instructor' : newRoles[0]

      await setSupabaseAppMeta(targetUser.id, { role: primaryRole, roles: newRoles, studioIds: newIds })

      // Upsert Member record
      const primaryStudioId = newIds[0]
      const existingMember = await prisma.member.findUnique({ where: { userId: targetUser.id } })
      if (existingMember) {
        await prisma.member.update({
          where: { userId: targetUser.id },
          data: {
            staffRoles: newRoles,
            studioIds: newIds,
          },
        })
      } else {
        await prisma.member.create({
          data: { userId: targetUser.id, studioId: primaryStudioId, staffRoles: newRoles, studioIds: newIds, source: 'packd' },
        })
      }

      // Upsert Instructor record for this specific studio
      if (newRoles.includes('instructor')) {
        await prisma.instructor.upsert({
          where: { userId_studioId: { userId: targetUser.id, studioId } },
          create: { userId: targetUser.id, studioId },
          update: {},
        })
      }

      return reply.send({ success: true, staffRoles: newRoles, studioIds: newIds })
    },
  )

  // DELETE /staff/:memberId?studioId=X&role=Y
  // role param (optional): remove just that role. Omit to remove all roles from the studio.
  // If no studios remain after removal, reverts the user to a regular member.
  app.delete<{ Params: { memberId: string }; Querystring: { studioId?: string; role?: string } }>(
    '/:memberId',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { memberId } = request.params
      const { studioId: callerStudioId, role: roleToRemove } = request.query

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

      // Compute remaining roles after this removal
      const currentRoles: string[] = current.roles ?? (member.staffRoles.length > 0 ? member.staffRoles : [])
      const remainingRoles = roleToRemove
        ? currentRoles.filter(r => r !== roleToRemove)
        : [] // no role param = remove all roles from this studio

      // Only remove the studioId when stripping all roles — if a role remains, the member
      // still belongs to this studio so keep it in the studioIds array
      const allStudioIds = current.studioIds ?? [member.studioId]
      const remainingStudios = remainingRoles.length > 0
        ? allStudioIds                                          // still has roles here — keep studio
        : allStudioIds.filter(id => id !== studioToRemove)     // no roles left — leave the studio

      const removingInstructor = roleToRemove === 'instructor' || (!roleToRemove && currentRoles.includes('instructor'))

      if (remainingRoles.length === 0 && remainingStudios.length === 0) {
        // No roles, no studios — fully revert to member
        await setSupabaseAppMeta(member.user.id, { role: 'member', roles: [], studioIds: [] })
        await prisma.member.update({ where: { id: memberId }, data: { staffRoles: [], studioIds: [] } })
        if (removingInstructor) {
          await prisma.instructor.deleteMany({ where: { userId: member.user.id, studioId: studioToRemove } })
        }
      } else if (remainingRoles.length === 0) {
        // No roles left but still in other studios — revert to member
        await setSupabaseAppMeta(member.user.id, { role: 'member', roles: [], studioIds: remainingStudios })
        await prisma.member.update({
          where: { id: memberId },
          data: { studioId: remainingStudios[0], staffRoles: [], studioIds: remainingStudios },
        })
        if (removingInstructor) {
          await prisma.instructor.deleteMany({ where: { userId: member.user.id, studioId: studioToRemove } })
        }
      } else {
        // Still has roles — update accordingly
        const primaryRole = remainingRoles.includes('instructor') ? 'instructor' : remainingRoles[0]
        const newStudios = remainingStudios.length > 0 ? remainingStudios : [studioToRemove]
        await setSupabaseAppMeta(member.user.id, { role: primaryRole, roles: remainingRoles, studioIds: newStudios })
        await prisma.member.update({
          where: { id: memberId },
          data: { studioId: newStudios[0], staffRoles: remainingRoles, studioIds: newStudios },
        })
        if (removingInstructor) {
          await prisma.instructor.deleteMany({ where: { userId: member.user.id, studioId: studioToRemove } })
        } else if (remainingRoles.includes('instructor')) {
          await prisma.instructor.updateMany({
            where: { userId: member.user.id, studioId: studioToRemove },
            data: { studioId: newStudios[0] },
          })
        }
      }

      return reply.send({ success: true, remainingRoles, remainingStudios: remainingStudios.length })
    },
  )
}
