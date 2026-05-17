import type { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@packd/db'
import { prisma } from '@packd/db'
import { ROLE_RANK } from '@packd/types'
import { requireRole, getUser } from '../lib/auth.js'

interface InstructorPermissions {
  canCheckInMembers: boolean
  canManageBookings: boolean
  canViewMemberContact: boolean
  canManageWaitlist: boolean
  canEditSessionDetails: boolean
  canCancelSession: boolean
  canCreateSchedules: boolean
}

const DEFAULT_PERMISSIONS: InstructorPermissions = {
  canCheckInMembers: true,
  canManageBookings: false,
  canViewMemberContact: false,
  canManageWaitlist: true,
  canEditSessionDetails: false,
  canCancelSession: false,
  canCreateSchedules: false,
}

async function assertStudioAccess(
  userId: string,
  userRole: string,
  studioId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (ROLE_RANK[userRole as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']) {
    return true
  }

  const member = await prisma.member.findUnique({
    where: { userId },
    select: { studioId: true },
  })

  if (!member || member.studioId !== studioId) {
    reply.code(403).send({ error: 'Access denied to this studio' })
    return false
  }

  return true
}

export async function franchiseRoutes(app: FastifyInstance) {
  app.get(
    '/studios',
    { preHandler: requireRole('franchise_admin') },
    async (_request, reply) => {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const tomorrowStart = new Date(todayStart)
      tomorrowStart.setDate(tomorrowStart.getDate() + 1)

      const studios = await prisma.studio.findMany({
        include: {
          _count: {
            select: {
              members: true,
              instructors: true,
            },
          },
        },
      })

      const todaySessions = await prisma.classSession.findMany({
        where: {
          startsAt: {
            gte: todayStart,
            lt: tomorrowStart,
          },
        },
        select: {
          studioId: true,
          capacity: true,
          _count: {
            select: {
              bookings: {
                where: { status: 'CONFIRMED' },
              },
            },
          },
        },
      })

      const sessionsByStudio = new Map<
        string,
        { count: number; totalFill: number }
      >()

      for (const session of todaySessions) {
        const existing = sessionsByStudio.get(session.studioId) ?? {
          count: 0,
          totalFill: 0,
        }
        const fillRate = session.capacity > 0
          ? session._count.bookings / session.capacity
          : 0
        sessionsByStudio.set(session.studioId, {
          count: existing.count + 1,
          totalFill: existing.totalFill + fillRate,
        })
      }

      const result = studios.map((studio) => {
        const sessionStats = sessionsByStudio.get(studio.id)
        const fillRateToday = sessionStats && sessionStats.count > 0
          ? Math.round((sessionStats.totalFill / sessionStats.count) * 100)
          : 0

        return {
          id: studio.id,
          name: studio.name,
          slug: studio.slug,
          timezone: studio.timezone,
          currency: studio.currency,
          memberCount: studio._count.members,
          todaySessionCount: sessionStats?.count ?? 0,
          instructorCount: studio._count.instructors,
          fillRateToday,
        }
      })

      return reply.send(result)
    },
  )

  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/instructors',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const hasAccess = await assertStudioAccess(user.id, user.role, studioId, reply)
      if (!hasAccess) return

      const instructors = await prisma.instructor.findMany({
        where: { studioId },
        include: { user: true },
      })

      const result = instructors.map((instructor) => {
        const raw = instructor.permissions as Record<string, unknown>
        const hasKeys = raw && Object.keys(raw).length > 0
        const permissions: InstructorPermissions = hasKeys
          ? { ...DEFAULT_PERMISSIONS, ...(raw as Partial<InstructorPermissions>) }
          : { ...DEFAULT_PERMISSIONS }

        return {
          id: instructor.id,
          userId: instructor.userId,
          name: `${instructor.user.firstName} ${instructor.user.lastName}`,
          email: instructor.user.email,
          permissions,
        }
      })

      return reply.send(result)
    },
  )

  // Instructors fetch their own record (id + permissions) — lower role threshold
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/my-instructor',
    { preHandler: requireRole('instructor') },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const instructor = await prisma.instructor.findFirst({
        where: { studioId, userId: user.id },
      })

      if (!instructor) {
        return reply.code(404).send({ error: 'Instructor record not found' })
      }

      const raw = instructor.permissions as Record<string, unknown>
      const hasKeys = raw && Object.keys(raw).length > 0
      const permissions: InstructorPermissions = hasKeys
        ? { ...DEFAULT_PERMISSIONS, ...(raw as Partial<InstructorPermissions>) }
        : { ...DEFAULT_PERMISSIONS }

      return reply.send({ id: instructor.id, permissions })
    },
  )

  app.patch<{
    Params: { studioId: string; instructorId: string }
    Body: Partial<InstructorPermissions>
  }>(
    '/studios/:studioId/instructors/:instructorId/permissions',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { studioId, instructorId } = request.params
      const user = getUser(request)

      const hasAccess = await assertStudioAccess(user.id, user.role, studioId, reply)
      if (!hasAccess) return

      const instructor = await prisma.instructor.findUnique({
        where: { id: instructorId, studioId },
      })

      if (!instructor) {
        return reply.code(404).send({ error: 'Instructor not found' })
      }

      const VALID_PERMISSION_KEYS: (keyof InstructorPermissions)[] = [
        'canCheckInMembers', 'canManageBookings', 'canViewMemberContact',
        'canManageWaitlist', 'canEditSessionDetails', 'canCancelSession', 'canCreateSchedules',
      ]
      const sanitized = Object.fromEntries(
        Object.entries(request.body).filter(([k, v]) =>
          VALID_PERMISSION_KEYS.includes(k as keyof InstructorPermissions) && typeof v === 'boolean'
        )
      ) as Partial<InstructorPermissions>

      const existing = instructor.permissions as Record<string, unknown>
      const hasKeys = existing && Object.keys(existing).length > 0
      const currentPermissions: InstructorPermissions = hasKeys
        ? { ...DEFAULT_PERMISSIONS, ...(existing as Partial<InstructorPermissions>) }
        : { ...DEFAULT_PERMISSIONS }

      const merged: InstructorPermissions = { ...currentPermissions, ...sanitized }

      const updated = await prisma.instructor.update({
        where: { id: instructorId },
        data: { permissions: merged as unknown as Prisma.InputJsonValue },
      })

      return reply.send({ success: true, permissions: updated.permissions })
    },
  )
}
