import type { FastifyInstance, FastifyReply } from 'fastify'
import { Prisma } from '@packd/db'
import { prisma } from '@packd/db'
import { ROLE_RANK } from '@packd/types'
import { requireRole, getUser } from '../lib/auth.js'
import { getSupabaseAppMeta, setSupabaseAppMeta, getPrimaryRole } from '../lib/supabase-admin.js'

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// 60-second in-process cache for the Supabase user list (avoid fetching 1000 users per request)
interface SbUser { id: string; email?: string; created_at?: string; app_metadata?: Record<string, unknown>; user_metadata?: Record<string, unknown> }
let sbUsersCache: { ts: number; users: SbUser[] } | null = null
const SB_USERS_TTL_MS = 60_000

async function fetchSupabaseUsers(): Promise<SbUser[]> {
  const now = Date.now()
  if (sbUsersCache && now - sbUsersCache.ts < SB_USERS_TTL_MS) return sbUsersCache.users
  const SUPABASE_URL = process.env.SUPABASE_URL!
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY },
  })
  const data = await res.json() as { users?: SbUser[] }
  const users = data.users ?? []
  sbUsersCache = { ts: now, users }
  return users
}

interface InstructorPermissions {
  canCheckInMembers: boolean
  canManageBookings: boolean
  canViewMemberContact: boolean
  canManageWaitlist: boolean
  canEditSessionDetails: boolean
  canCancelSession: boolean
  canCreateSchedules: boolean
  canSetSubstitute: boolean
}

const DEFAULT_INSTRUCTOR_PERMISSIONS: InstructorPermissions = {
  canCheckInMembers: false,
  canManageBookings: false,
  canViewMemberContact: false,
  canManageWaitlist: true,
  canEditSessionDetails: false,
  canCancelSession: false,
  canCreateSchedules: false,
  canSetSubstitute: false,
}


interface FronthostPermissions {
  canCheckInMembers: boolean
  canAdjustCredits: boolean
  canManageBookings: boolean
  canManageWaitlist: boolean
  canViewMemberContact: boolean
}

const DEFAULT_FRONTHOST_PERMISSIONS: FronthostPermissions = {
  canCheckInMembers: true,
  canAdjustCredits: true,
  canManageBookings: true,
  canManageWaitlist: true,
  canViewMemberContact: true,
}

export async function assertStudioAccess(
  userId: string,
  userRole: string,
  studioId: string,
  reply: FastifyReply,
  studioIds?: string[],
): Promise<boolean> {
  if (ROLE_RANK[userRole as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']) {
    return true
  }

  // Check JWT studioIds first (no DB round-trip needed)
  if (studioIds && studioIds.includes(studioId)) {
    return true
  }

  const member = await prisma.member.findUnique({
    where: { userId },
    select: { studioId: true, studioIds: true },
  })

  if (!member || (!member.studioIds.includes(studioId) && member.studioId !== studioId)) {
    reply.code(403).send({ error: 'Access denied to this studio' })
    return false
  }

  return true
}

export async function franchiseRoutes(app: FastifyInstance) {
  // GET /franchise/my-studios — studios accessible to the caller
  // franchise_admin+: all studios; studio_admin: only their studioIds
  app.get(
    '/my-studios',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const user = getUser(request)
      const isFranchise = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']

      const studios = isFranchise
        ? await prisma.studio.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } })
        : await prisma.studio.findMany({
            where: { id: { in: user.studioIds } },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, slug: true },
          })

      return reply.send(studios)
    },
  )

  // GET /franchise/info — name of the franchise the caller belongs to (franchise_admin only)
  app.get(
    '/info',
    { preHandler: requireRole('franchise_admin') },
    async (request, reply) => {
      const user = getUser(request)
      if (!user.franchiseId) return reply.send({ id: null, name: null })
      const franchise = await prisma.franchise.findUnique({
        where: { id: user.franchiseId },
        select: { id: true, name: true },
      })
      return reply.send(franchise ?? { id: null, name: null })
    },
  )

  app.get(
    '/studios',
    { preHandler: requireRole('franchise_admin') },
    async (_request, reply) => {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const tomorrowStart = new Date(todayStart)
      tomorrowStart.setDate(tomorrowStart.getDate() + 1)

      const [studios, allStaff] = await Promise.all([
        prisma.studio.findMany({
          include: {
            _count: {
              select: { members: true },
            },
          },
        }),
        // Count staff per studio (instructors + fronthosts, deduped for dual-role)
        prisma.member.findMany({
          where: { staffRoles: { isEmpty: false } },
          select: { studioIds: true },
        }),
      ])

      const staffCountByStudio = new Map<string, number>()
      for (const m of allStaff) {
        for (const sid of m.studioIds) {
          staffCountByStudio.set(sid, (staffCountByStudio.get(sid) ?? 0) + 1)
        }
      }

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
          staffCount: staffCountByStudio.get(studio.id) ?? 0,
          fillRateToday,
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
        ? { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...(raw as Partial<InstructorPermissions>) }
        : { ...DEFAULT_INSTRUCTOR_PERMISSIONS }

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

      const hasAccess = await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)
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
        'canSetSubstitute',
      ]
      const sanitized = Object.fromEntries(
        Object.entries(request.body).filter(([k, v]) =>
          VALID_PERMISSION_KEYS.includes(k as keyof InstructorPermissions) && typeof v === 'boolean'
        )
      ) as Partial<InstructorPermissions>

      const existing = instructor.permissions as Record<string, unknown>
      const hasKeys = existing && Object.keys(existing).length > 0
      const currentPermissions: InstructorPermissions = hasKeys
        ? { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...(existing as Partial<InstructorPermissions>) }
        : { ...DEFAULT_INSTRUCTOR_PERMISSIONS }

      const merged: InstructorPermissions = { ...currentPermissions, ...sanitized }

      const updated = await prisma.instructor.update({
        where: { id: instructorId },
        data: { permissions: merged as unknown as Prisma.InputJsonValue },
      })

      return reply.send({ success: true, permissions: updated.permissions })
    },
  )

  // GET /studios/:studioId/staff-permissions — all staff (instructors + fronthosts) with their permissions
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/staff-permissions',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const hasAccess = await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)
      if (!hasAccess) return

      // Find instructor members by their staff assignment (not by Instructor.studioId, which
      // may point to a different studio for legacy records). For each, prefer the studio-scoped
      // Instructor record; fall back to any record they have (carries their permissions).
      const [instructorMembers, fronthosts] = await Promise.all([
        prisma.member.findMany({
          where: { studioIds: { has: studioId }, staffRoles: { has: 'instructor' } },
          include: { user: { include: { instructors: true } } },
        }),
        prisma.member.findMany({
          where: { studioIds: { has: studioId }, staffRoles: { has: 'fronthost' } },
          include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
        }),
      ])

      // Ensure a studio-scoped Instructor record exists for any that only have a legacy record
      for (const m of instructorMembers) {
        const hasStudioRecord = m.user.instructors.some(i => i.studioId === studioId)
        if (!hasStudioRecord) {
          const any = m.user.instructors[0]
          const created = await prisma.instructor.create({
            data: { userId: m.userId, studioId, permissions: any?.permissions ?? {} },
          })
          m.user.instructors.push(created)
        }
      }

      // Build a map keyed by userId so dual-role members get a single merged entry
      const byUserId = new Map<string, {
        id: string
        memberId: string | null
        userId: string
        name: string
        email: string
        roles: ('instructor' | 'fronthost')[]
        instructorPermissions?: InstructorPermissions
        fronthostPermissions?: FronthostPermissions
      }>()

      for (const m of instructorMembers) {
        const inst = m.user.instructors.find(i => i.studioId === studioId) ?? m.user.instructors[0]
        if (!inst) continue
        const raw = inst.permissions as Record<string, unknown>
        const hasKeys = raw && Object.keys(raw).length > 0
        const instructorPermissions: InstructorPermissions = hasKeys
          ? { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...(raw as Partial<InstructorPermissions>) }
          : { ...DEFAULT_INSTRUCTOR_PERMISSIONS }
        byUserId.set(m.userId, {
          id: inst.id,
          memberId: null,
          userId: m.userId,
          name: `${m.user.firstName} ${m.user.lastName}`,
          email: m.user.email,
          roles: ['instructor'],
          instructorPermissions,
        })
      }

      for (const m of fronthosts) {
        const raw = m.staffPermissions as Record<string, unknown> | null
        const hasKeys = raw && Object.keys(raw).length > 0
        const fronthostPermissions: FronthostPermissions = hasKeys
          ? { ...DEFAULT_FRONTHOST_PERMISSIONS, ...(raw as Partial<FronthostPermissions>) }
          : { ...DEFAULT_FRONTHOST_PERMISSIONS }

        const existing = byUserId.get(m.userId)
        if (existing) {
          // Dual-role: merge into existing instructor entry
          existing.roles.push('fronthost')
          existing.memberId = m.id
          existing.fronthostPermissions = fronthostPermissions
        } else {
          byUserId.set(m.userId, {
            id: m.id,
            memberId: m.id,
            userId: m.userId,
            name: `${m.user.firstName} ${m.user.lastName}`,
            email: m.user.email,
            roles: ['fronthost'],
            fronthostPermissions,
          })
        }
      }

      return reply.send(Array.from(byUserId.values()))
    },
  )

  // ── Studio admin management (franchise_admin only) ───────────────────────────

  // GET /franchise/studios/:studioId/admins — list studio_admin members for a studio.
  // Uses Supabase as source of truth for roles so admins set up via Supabase dashboard
  // or direct API calls are included even if Member.staffRoles is not yet synced.
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/admins',
    { preHandler: requireRole('franchise_admin') },
    async (request, reply) => {
      const { studioId } = request.params

      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      // Fetch all Supabase users (cached 60s) and filter by role + studio
      const sbUsers = await fetchSupabaseUsers()

      // Match users who have studio_admin in roles AND studioId in studioIds.
      // Support both new format (roles array + studioIds) and old format (role + studioId).
      const adminSbUsers = sbUsers.filter(u => {
        const meta = u.app_metadata ?? {}
        const roles: string[] = (meta.roles as string[] | undefined) ?? (meta.role ? [meta.role as string] : [])
        const ids: string[] = (meta.studioIds as string[] | undefined) ?? (meta.studioId ? [meta.studioId as string] : [])
        return roles.includes('studio_admin') && ids.includes(studioId)
      })

      if (adminSbUsers.length === 0) return reply.send([])

      const adminUserIds = adminSbUsers.map(u => u.id)

      // Look up Member + User records for display info; some may not have a Member record yet
      const members = await prisma.member.findMany({
        where: { userId: { in: adminUserIds } },
        include: { user: { select: { firstName: true, lastName: true, email: true } } },
      })
      const memberByUserId = new Map(members.map(m => [m.userId, m]))

      // Sync staffRoles in DB for any admin whose Member record is out of date
      for (const m of members) {
        if (!m.staffRoles.includes('studio_admin')) {
          const newRoles = [...new Set([...m.staffRoles, 'studio_admin'])]
          const newIds = [...new Set([...m.studioIds, studioId])]
          await prisma.member.update({
            where: { id: m.id },
            data: { staffRoles: newRoles, studioIds: newIds },
          }).catch(() => { /* non-fatal */ })
        }
      }

      return reply.send(adminSbUsers.map(su => {
        const m = memberByUserId.get(su.id)
        // Fall back to Supabase user_metadata for name if no Member record exists
        const meta = su.user_metadata ?? {}
        const fallbackName = [meta.first_name, meta.last_name].filter(Boolean).join(' ') || su.email || su.id
        return {
          id: m?.id ?? su.id,
          userId: su.id,
          name: m ? `${m.user.firstName} ${m.user.lastName}` : fallbackName,
          email: su.email ?? m?.user.email ?? '',
          joinedAt: m?.joinedAt.toISOString() ?? su.created_at ?? new Date().toISOString(),
        }
      }))
    },
  )

  // POST /franchise/studios/:studioId/admins — promote a user to studio_admin
  app.post<{ Params: { studioId: string }; Body: { email: string } }>(
    '/studios/:studioId/admins',
    { preHandler: requireRole('franchise_admin') },
    async (request, reply) => {
      const { studioId } = request.params
      const { email } = request.body

      if (!email) return reply.badRequest('email is required')
      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      const studio = await prisma.studio.findUnique({ where: { id: studioId } })
      if (!studio) return reply.notFound('Studio not found')

      const targetUser = await prisma.user.findUnique({ where: { email } })
      if (!targetUser) return reply.notFound('No account found with that email address. The user must sign up first.')

      const current = await getSupabaseAppMeta(targetUser.id)
      const existingIds: string[] = current.studioIds ?? []
      const newIds = [...new Set([...existingIds, studioId])]

      const existingRoles: string[] = current.roles ?? (current.role && current.role !== 'member' ? [current.role] : [])
      const newRoles = [...new Set([...existingRoles, 'studio_admin'])]
      const primaryRole = getPrimaryRole(newRoles)

      await setSupabaseAppMeta(targetUser.id, { role: primaryRole, roles: newRoles, studioIds: newIds })

      const existingMember = await prisma.member.findUnique({ where: { userId: targetUser.id } })
      if (existingMember) {
        await prisma.member.update({
          where: { userId: targetUser.id },
          data: { staffRoles: newRoles, studioIds: newIds },
        })
      } else {
        await prisma.member.create({
          data: { userId: targetUser.id, studioId, staffRoles: newRoles, studioIds: newIds, source: 'packd' },
        })
      }

      sbUsersCache = null // invalidate cache
      return reply.code(201).send({ success: true, roles: newRoles })
    },
  )

  // DELETE /franchise/studios/:studioId/admins/:userId — remove studio_admin for a studio
  app.delete<{ Params: { studioId: string; userId: string } }>(
    '/studios/:studioId/admins/:userId',
    { preHandler: requireRole('franchise_admin') },
    async (request, reply) => {
      const { studioId, userId } = request.params

      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured on server')

      const member = await prisma.member.findUnique({
        where: { userId },
        select: { id: true, studioIds: true, staffRoles: true },
      })
      if (!member) return reply.notFound('User not found')

      const current = await getSupabaseAppMeta(userId)
      const currentRoles: string[] = current.roles ?? member.staffRoles
      const remainingRoles = currentRoles.filter(r => r !== 'studio_admin')

      // Remove studioId only if no other roles remain for this studio
      const allStudioIds: string[] = current.studioIds ?? member.studioIds
      const remainingStudios = remainingRoles.length > 0
        ? allStudioIds
        : allStudioIds.filter(id => id !== studioId)

      const primaryRole = getPrimaryRole(remainingRoles)
      await setSupabaseAppMeta(userId, { role: primaryRole, roles: remainingRoles, studioIds: remainingStudios })
      await prisma.member.update({
        where: { id: member.id },
        data: { staffRoles: remainingRoles, studioIds: remainingStudios },
      })

      sbUsersCache = null // invalidate cache
      return reply.send({ success: true })
    },
  )

  // PATCH /studios/:studioId/fronthosts/:memberId/permissions — update fronthost permissions
  app.patch<{
    Params: { studioId: string; memberId: string }
    Body: Partial<FronthostPermissions>
  }>(
    '/studios/:studioId/fronthosts/:memberId/permissions',
    { preHandler: requireRole('studio_admin') },
    async (request, reply) => {
      const { studioId, memberId } = request.params
      const user = getUser(request)

      const hasAccess = await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)
      if (!hasAccess) return

      const member = await prisma.member.findFirst({
        where: { id: memberId, studioIds: { has: studioId }, staffRoles: { has: 'fronthost' } },
      })

      if (!member) return reply.code(404).send({ error: 'Fronthost not found' })

      const VALID_KEYS: (keyof FronthostPermissions)[] = [
        'canCheckInMembers', 'canAdjustCredits', 'canManageBookings', 'canManageWaitlist', 'canViewMemberContact',
      ]
      const sanitized = Object.fromEntries(
        Object.entries(request.body).filter(([k, v]) =>
          VALID_KEYS.includes(k as keyof FronthostPermissions) && typeof v === 'boolean'
        )
      ) as Partial<FronthostPermissions>

      const existing = member.staffPermissions as Record<string, unknown> | null
      const current: FronthostPermissions = existing && Object.keys(existing).length > 0
        ? { ...DEFAULT_FRONTHOST_PERMISSIONS, ...(existing as Partial<FronthostPermissions>) }
        : { ...DEFAULT_FRONTHOST_PERMISSIONS }

      const merged: FronthostPermissions = { ...current, ...sanitized }

      await prisma.member.update({
        where: { id: memberId },
        data: { staffPermissions: merged as unknown as Prisma.InputJsonValue },
      })

      return reply.send({ success: true, permissions: merged })
    },
  )
}
