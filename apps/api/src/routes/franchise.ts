import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { Prisma } from '@packd/db'
import { prisma } from '@packd/db'
import { ROLE_RANK } from '@packd/types'
import { requireRole, getUser } from '../lib/auth.js'
import { getSupabaseAppMeta, setSupabaseAppMeta, getPrimaryRole, generatePasswordSetupLink, fetchSupabaseUsers, invalidateSupabaseUsersCache, type SbUser } from '../lib/supabase-admin.js'
import { assertStudioAccess } from './admin-shared.js'
import { enqueueBroadcast } from '../jobs/index.js'
import { Id, CursorQuery } from '../schemas.js'
import {
  StudioSummarySchema, StaffMemberSchema, StaffWithPermissionsSchema, PromoCodeSchema,
} from '../schemas/responses.js'

export { assertStudioAccess }

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ── Route validation schemas ──────────────────────────────────────────────────
const StaffListQuery = z.object({ cursor: z.string().optional(), take: z.string().optional() })
const PromoBody = z.object({
  code: z.string().min(1),
  description: z.string().optional(),
  type: z.string().min(1),
  value: z.number(),
  maxUses: z.number().int().positive().nullable().optional(),
  validFrom: z.string().optional(),
  validUntil: z.string().nullable().optional(),
})
const PromoParams = z.object({ code: z.string().min(1) })
const BroadcastBody = z.object({
  studioIds: z.array(Id).min(1),
  subject: z.string().min(1),
  message: z.string().min(1),
})


interface InstructorPermissions {
  canCheckInMembers: boolean
  canManageBookings: boolean
  canViewMemberContact: boolean
  canManageWaitlist: boolean
  canEditSessionDetails: boolean
  canCancelSession: boolean
  canCreateSchedules: boolean
  canSetSubstitute: boolean
  canGrantCredits: boolean
  canManagePromoCodes: boolean
  canViewPurchaseHistory: boolean
  canOverrideBookingRestrictions: boolean
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
  canGrantCredits: false,
  canManagePromoCodes: false,
  canViewPurchaseHistory: false,
  canOverrideBookingRestrictions: false,
}


interface FronthostPermissions {
  canCheckInMembers: boolean
  canAdjustCredits: boolean
  canManageBookings: boolean
  canManageWaitlist: boolean
  canViewMemberContact: boolean
  canGrantCredits: boolean
  canIssueRefunds: boolean
  canManagePromoCodes: boolean
  canViewPurchaseHistory: boolean
  canExportData: boolean
  canOverrideBookingRestrictions: boolean
}

const DEFAULT_FRONTHOST_PERMISSIONS: FronthostPermissions = {
  canCheckInMembers: true,
  canAdjustCredits: true,
  canManageBookings: true,
  canManageWaitlist: true,
  canViewMemberContact: true,
  canGrantCredits: true,
  canIssueRefunds: true,
  canManagePromoCodes: false,
  canViewPurchaseHistory: true,
  canExportData: false,
  canOverrideBookingRestrictions: true,
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

  // DELETE /franchise — delete this franchise (admin only; blocked if studios are attached)
  app.delete(
    '/',
    { preHandler: requireRole('admin') },
    async (request, reply) => {
      const user = getUser(request)
      if (!user.franchiseId) return reply.badRequest('No franchise associated with this account')

      const franchise = await prisma.franchise.findUnique({
        where: { id: user.franchiseId },
        select: {
          name: true,
          _count: { select: { studios: true } },
        },
      })
      if (!franchise) return reply.notFound('Franchise not found')

      if (franchise._count.studios > 0) {
        return reply.badRequest(
          `Cannot delete "${franchise.name}": it has ${franchise._count.studios} studio${franchise._count.studios !== 1 ? 's' : ''} attached. Remove all studios first.`,
        )
      }

      await prisma.franchise.delete({ where: { id: user.franchiseId } })
      return reply.send({ success: true })
    },
  )

  app.get(
    '/studios',
    { preHandler: requireRole('franchise_admin'), schema: { response: { 200: z.array(StudioSummarySchema) } } },
    async (request, reply) => {
      const user = getUser(request)
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const tomorrowStart = new Date(todayStart)
      tomorrowStart.setDate(tomorrowStart.getDate() + 1)

      const monthStart = new Date()
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

      // Scope studios to the caller's franchise if they have one
      const franchiseFilter = user.franchiseId
        ? { franchiseMemberships: { some: { franchiseId: user.franchiseId } } }
        : {}

      const [studios, allStaff, monthlySales] = await Promise.all([
        prisma.studio.findMany({
          where: franchiseFilter,
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
        // Revenue this month from product sales (non-refunded)
        prisma.productSale.groupBy({
          by: ['studioId'],
          where: { soldAt: { gte: monthStart }, refundedAt: null },
          _sum: { totalCents: true },
        }),
      ])

      const staffCountByStudio = new Map<string, number>()
      for (const m of allStaff) {
        for (const sid of m.studioIds) {
          staffCountByStudio.set(sid, (staffCountByStudio.get(sid) ?? 0) + 1)
        }
      }

      const revenueByStudio = new Map<string, number>()
      for (const row of monthlySales) {
        revenueByStudio.set(row.studioId, row._sum.totalCents ?? 0)
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
          revenueThisMonthCents: revenueByStudio.get(studio.id) ?? 0,
        }
      })

      return reply.send(result)
    },
  )

  // Fronthosts fetch their own permissions for this studio
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/my-fronthost-permissions',
    { preHandler: requireRole('instructor') }, // rank ≥ instructor covers fronthost too
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const member = await prisma.member.findFirst({
        where: { userId: user.id, studioIds: { has: studioId } },
        select: { staffPermissions: true },
      })

      if (!member) return reply.code(404).send({ error: 'Not a staff member for this studio' })

      const raw = member.staffPermissions as Record<string, unknown> | null
      const permissions: FronthostPermissions = raw && Object.keys(raw).length > 0
        ? { ...DEFAULT_FRONTHOST_PERMISSIONS, ...(raw as Partial<FronthostPermissions>) }
        : { ...DEFAULT_FRONTHOST_PERMISSIONS }

      return reply.send({ permissions })
    },
  )

  // Instructors fetch their own record (id + permissions) — lower role threshold
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/my-instructor',
    { preHandler: requireRole('instructor') },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      const [instructor, member, userRecord] = await Promise.all([
        prisma.instructor.findFirst({ where: { studioId, userId: user.id } }),
        prisma.member.findFirst({
          where: { userId: user.id, studioIds: { has: studioId } },
          select: { id: true },
        }),
        prisma.user.findUnique({ where: { id: user.id }, select: { avatarUrl: true } }),
      ])

      if (!instructor) {
        return reply.code(404).send({ error: 'Instructor record not found' })
      }

      const raw = instructor.permissions as Record<string, unknown>
      const hasKeys = raw && Object.keys(raw).length > 0
      const permissions: InstructorPermissions = hasKeys
        ? { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...(raw as Partial<InstructorPermissions>) }
        : { ...DEFAULT_INSTRUCTOR_PERMISSIONS }

      return reply.send({
        id: instructor.id,
        memberId: member?.id ?? null,
        avatarUrl: userRecord?.avatarUrl ?? null,
        permissions,
      })
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
        'canSetSubstitute', 'canGrantCredits', 'canManagePromoCodes',
        'canViewPurchaseHistory', 'canOverrideBookingRestrictions',
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { permissions: merged as unknown as object },
      })

      return reply.send({ success: true, permissions: updated.permissions })
    },
  )

  // GET /studios/:studioId/staff-permissions — all staff (instructors + fronthosts) with their permissions
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/staff-permissions',
    { preHandler: requireRole('studio_admin'), schema: { response: { 200: z.array(StaffWithPermissionsSchema) } } },
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
      const memberByUserId = new Map<string, typeof members[number]>(members.map(m => [m.userId, m] as [string, typeof members[number]]))

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

      invalidateSupabaseUsersCache() // invalidate cache
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

      invalidateSupabaseUsersCache() // invalidate cache
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
        'canGrantCredits', 'canIssueRefunds', 'canManagePromoCodes', 'canViewPurchaseHistory',
        'canExportData', 'canOverrideBookingRestrictions',
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { staffPermissions: merged as unknown as object },
      })

      return reply.send({ success: true, permissions: merged })
    },
  )

  // ── Franchise-wide staff + admin rosters ────────────────────────────────────

  // GET /franchise/staff — all staff across all studios with studio memberships resolved
  app.get<{ Querystring: { cursor?: string; take?: string } }>(
    '/staff',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { querystring: StaffListQuery },
    },
    async (request, reply) => {
      const { cursor, take: takeStr } = request.query
      const take = Math.min(parseInt(takeStr ?? '100', 10) || 100, 200)

      const [studios, members] = await Promise.all([
        prisma.studio.findMany({ select: { id: true, name: true } }),
        prisma.member.findMany({
          where: {
            // Only show studio-level staff — exclude platform roles (admin, brand_admin)
            // that have no business appearing in the franchise staff roster
            staffRoles: { hasSome: ['franchise_admin', 'studio_admin', 'instructor', 'fronthost'] },
          },
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                instructors: { select: { id: true, studioId: true, payRatePerHeadCents: true } },
              },
            },
          },
          orderBy: [{ user: { lastName: 'asc' } }, { user: { firstName: 'asc' } }],
          take: take + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        }),
      ])
      const studioMap = new Map(studios.map(s => [s.id, s.name]))
      const hasMore = members.length > take
      const items = hasMore ? members.slice(0, take) : members
      return reply.send({
        items: items.map(m => ({
          id: m.id,
          userId: m.userId,
          name: `${m.user.firstName} ${m.user.lastName}`,
          email: m.user.email,
          roles: m.staffRoles,
          studioIds: m.studioIds,
          studios: m.studioIds.map(id => ({ id, name: studioMap.get(id) ?? id })),
          payRateHourlyCents: m.payRateHourlyCents ?? null,
          instructorRates: m.user.instructors.map(i => ({
            instructorId: i.id,
            studioId: i.studioId,
            studioName: studioMap.get(i.studioId) ?? i.studioId,
            payRatePerHeadCents: i.payRatePerHeadCents ?? null,
          })),
        })),
        nextCursor: hasMore ? items[items.length - 1].id : null,
        hasMore,
      })
    },
  )

  // GET /franchise/all-admins — all studio_admins aggregated across studios with studio names
  app.get(
    '/all-admins',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { querystring: CursorQuery },
    },
    async (request, reply) => {
      if (!SERVICE_ROLE_KEY) return reply.internalServerError('SUPABASE_SERVICE_ROLE_KEY not configured')

      const { cursor, take } = request.query as { cursor?: string; take: number }

      const [studios, sbUsers, members] = await Promise.all([
        prisma.studio.findMany({ select: { id: true, name: true } }),
        fetchSupabaseUsers(),
        prisma.member.findMany({
          where: { staffRoles: { has: 'studio_admin' } },
          include: { user: { select: { firstName: true, lastName: true, email: true } } },
        }),
      ])

      const studioMap = new Map(studios.map(s => [s.id, s.name]))
      const memberByUserId = new Map(members.map(m => [m.userId, m]))

      // Collect all users who have studio_admin role in Supabase
      const adminSbUsers = sbUsers.filter(u => {
        const meta = u.app_metadata ?? {}
        const roles: string[] = (meta.roles as string[] | undefined) ?? (meta.role ? [meta.role as string] : [])
        return roles.includes('studio_admin')
      })

      const all = adminSbUsers.map(su => {
        const meta = su.app_metadata ?? {}
        const studioIds: string[] = (meta.studioIds as string[] | undefined) ?? (meta.studioId ? [meta.studioId as string] : [])
        const m = memberByUserId.get(su.id)
        const fallbackName = su.email ?? su.id
        return {
          userId: su.id,
          name: m ? `${m.user.firstName} ${m.user.lastName}` : fallbackName,
          email: su.email ?? m?.user.email ?? '',
          studioIds,
          studios: studioIds.map(id => ({ id, name: studioMap.get(id) ?? id })),
        }
      }).sort((a, b) => a.name.localeCompare(b.name))

      // Paginate by userId cursor (stable sort key after name sort)
      const startIdx = cursor ? all.findIndex(x => x.userId === cursor) + 1 : 0
      const page = all.slice(startIdx, startIdx + take + 1)
      const hasMore = page.length > take
      const items = hasMore ? page.slice(0, take) : page
      return reply.send({ items, nextCursor: hasMore ? items[items.length - 1].userId : null, hasMore })
    },
  )

  // ── Franchise-wide promo codes ───────────────────────────────────────────────

  // GET /franchise/promos — list promo codes, aggregated across all franchise studios
  app.get(
    '/promos',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { querystring: CursorQuery },
    },
    async (request, reply) => {
      const { cursor, take } = request.query as { cursor?: string; take: number }
      const codes = await prisma.promoCode.findMany({
        orderBy: { code: 'asc' },
        include: { _count: { select: { redemptions: true } } },
      })
      // Group by code string; aggregate usage counts across studios
      const byCode = new Map<string, { code: string; description: string | null; type: string; value: number; maxUses: number | null; usageCount: number; studios: string[]; isActive: boolean; validUntil: string | null }>()
      for (const p of codes) {
        if (byCode.has(p.code)) {
          const entry = byCode.get(p.code)!
          entry.usageCount += p.usageCount
          entry.studios.push(p.studioId)
        } else {
          byCode.set(p.code, {
            code: p.code,
            description: p.description,
            type: p.type,
            value: p.value,
            maxUses: p.maxUses,
            usageCount: p.usageCount,
            studios: [p.studioId],
            isActive: p.isActive,
            validUntil: p.validUntil?.toISOString() ?? null,
          })
        }
      }
      // Paginate the grouped result by code string (cursor = last seen code)
      const all = [...byCode.values()]
      const startIdx = cursor ? all.findIndex(x => x.code === cursor) + 1 : 0
      const page = all.slice(startIdx, startIdx + take + 1)
      const hasMore = page.length > take
      const items = hasMore ? page.slice(0, take) : page
      return reply.send({ items, nextCursor: hasMore ? items[items.length - 1].code : null, hasMore })
    },
  )

  // POST /franchise/promos — create same promo code across all franchise studios
  app.post<{
    Body: {
      code: string
      description?: string
      type: string
      value: number
      maxUses?: number | null
      validFrom?: string
      validUntil?: string | null
    }
  }>(
    '/promos',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { body: PromoBody },
    },
    async (request, reply) => {
      const { code, description, type, value, maxUses, validFrom, validUntil } = request.body
      if (!code || !type) return reply.badRequest('code and type are required')

      const user = getUser(request)
      const franchiseFilter = user.franchiseId
        ? { franchiseMemberships: { some: { franchiseId: user.franchiseId } } }
        : {}
      const studios = await prisma.studio.findMany({ where: franchiseFilter, select: { id: true } })
      if (!studios.length) return reply.badRequest('No studios found')

      // Upsert to be idempotent — running twice won't create duplicates
      await prisma.$transaction(
        studios.map(s => prisma.promoCode.upsert({
          where: { studioId_code: { studioId: s.id, code } },
          update: { description, type, value, maxUses: maxUses ?? null, validUntil: validUntil ? new Date(validUntil) : null, isActive: true },
          create: { studioId: s.id, code, description, type, value, maxUses: maxUses ?? null, validFrom: validFrom ? new Date(validFrom) : new Date(), validUntil: validUntil ? new Date(validUntil) : null },
        }))
      )

      return reply.code(201).send({ success: true, studios: studios.length })
    },
  )

  // DELETE /franchise/promos/:code — remove a promo code from all studios
  app.delete<{ Params: { code: string } }>(
    '/promos/:code',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { params: PromoParams },
    },
    async (request, reply) => {
      const { code } = request.params
      const user = getUser(request)
      // Scope deletion to studios in the caller's franchise only
      if (user.franchiseId) {
        const franchiseStudioIds = await prisma.franchiseStudio.findMany({
          where: { franchiseId: user.franchiseId },
          select: { studioId: true },
        }).then(rows => rows.map(r => r.studioId))
        const { count } = await prisma.promoCode.deleteMany({
          where: { code, studioId: { in: franchiseStudioIds } },
        })
        return reply.send({ success: true, deleted: count })
      }
      const { count } = await prisma.promoCode.deleteMany({ where: { code } })
      return reply.send({ success: true, deleted: count })
    },
  )

  // ── Franchise broadcast ──────────────────────────────────────────────────────

  // POST /franchise/broadcast — send an email to all members of selected studios
  app.post<{ Body: { studioIds: string[]; subject: string; message: string } }>(
    '/broadcast',
    {
      preHandler: requireRole('franchise_admin'),
      config: { rateLimit: { max: 2, timeWindow: '1 minute' } },
      schema: { body: BroadcastBody },
    },
    async (request, reply) => {
      const { studioIds: rawStudioIds, subject, message } = request.body
      if (!rawStudioIds?.length) return reply.badRequest('studioIds is required')
      if (!subject?.trim() || !message?.trim()) return reply.badRequest('subject and message are required')

      const user = getUser(request)
      // Intersect requested studioIds with the caller's own franchise studios to prevent cross-franchise broadcast
      let studioIds = rawStudioIds
      if (user.franchiseId) {
        const myStudioIds = await prisma.franchiseStudio.findMany({
          where: { franchiseId: user.franchiseId },
          select: { studioId: true },
        }).then(rows => rows.map(r => r.studioId))
        studioIds = rawStudioIds.filter(id => myStudioIds.includes(id))
        if (!studioIds.length) return reply.forbidden('None of the requested studios belong to your franchise')
      }

      const studios = await prisma.studio.findMany({
        where: { id: { in: studioIds } },
        select: { id: true, name: true },
      })
      if (!studios.length) return reply.notFound('No matching studios')

      const total = await prisma.member.count({
        where: { studioId: { in: studioIds }, staffRoles: { isEmpty: true } },
      })

      const studioName = studios.length === 1 ? studios[0].name : studios.map(s => s.name).join(' & ')

      await enqueueBroadcast({ studioIds, subject, message, studioName })

      return reply.send({ success: true, queued: true, estimatedRecipients: total })
    },
  )

  // ── Franchise-level waiver management ─────────────────────────────────────
  // GET — fetch the representative active waiver (first studio that has one)
  app.get('/waiver', { preHandler: requireRole('franchise_admin') }, async (request, reply) => {
    const user = getUser(request)
    const studioIds = user.studioIds ?? []
    if (!studioIds.length) return reply.send({ waiver: null })

    const waiver = await prisma.waiver.findFirst({
      where: { studioId: { in: studioIds }, isActive: true },
      orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, body: true, version: true, studioId: true },
    })
    return reply.send({ waiver: waiver ?? null })
  })

  // PUT — set the same waiver on every studio in the franchise
  app.put('/waiver', {
    preHandler: requireRole('franchise_admin'),
    schema: { body: z.object({ title: z.string().min(1), body: z.string().min(1) }) },
  }, async (request, reply) => {
    const user = getUser(request)
    const { title, body } = request.body as { title: string; body: string }
    const studioIds = user.studioIds ?? []
    if (!studioIds.length) return reply.badRequest('No studios in this franchise')

    await Promise.all(studioIds.map(async studioId => {
      const existing = await prisma.waiver.findFirst({
        where: { studioId, isActive: true },
        select: { id: true, version: true },
      })
      const version = (existing?.version ?? 0) + 1
      await prisma.$transaction(async tx => {
        if (existing) await tx.waiver.update({ where: { id: existing.id }, data: { isActive: false } })
        await tx.waiver.create({ data: { studioId, title: title.trim(), body: body.trim(), isActive: true, version } })
      })
    }))

    return reply.send({ success: true })
  })

  // DELETE — disable waivers on every studio in the franchise
  app.delete('/waiver', { preHandler: requireRole('franchise_admin') }, async (request, reply) => {
    const user = getUser(request)
    const studioIds = user.studioIds ?? []
    if (studioIds.length) {
      await prisma.waiver.updateMany({ where: { studioId: { in: studioIds }, isActive: true }, data: { isActive: false } })
    }
    return reply.send({ success: true })
  })

  // ── Generate login link for a staff member within this franchise ───────────
  app.post('/login-link', {
    preHandler: requireRole('franchise_admin'),
    schema: { body: z.object({ email: z.string().email() }) },
  }, async (request, reply) => {
    const { email } = request.body as { email: string }
    const user = getUser(request)

    // Verify the target user is a member of one of this franchise's studios
    const franchiseStudioIds = await prisma.franchiseStudio.findMany({
      where: { franchise: { id: user.franchiseId ?? '' } },
      select: { studioId: true },
    }).then(rows => rows.map(r => r.studioId))

    if (franchiseStudioIds.length > 0) {
      const target = await prisma.member.findFirst({
        where: { user: { email }, studioId: { in: franchiseStudioIds } },
      })
      if (!target) return reply.forbidden('User not found in this franchise')
    }

    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000'
    const link = await generatePasswordSetupLink(email, `${webUrl}/login`)
    return { link }
  })
}
