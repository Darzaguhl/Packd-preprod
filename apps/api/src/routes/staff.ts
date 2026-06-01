import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'
import { prisma } from '@packd/db'
import { requireRole, requireAuth, getUser } from '../lib/auth.js'
import { audit, AUDIT } from '../lib/audit.js'
import { getSupabaseAppMeta, setSupabaseAppMeta, getPrimaryRole, revokeUserSessions } from '../lib/supabase-admin.js'
import { sendStaffInvite } from '../lib/email.js'
import { assertStudioAccess } from './admin-shared.js'
import { Id, MemberIdParam } from '../schemas.js'

// ── Route validation schemas ──────────────────────────────────────────────────
const StaffListQuery = z.object({ studioId: Id })
const InviteBody = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  role: z.enum(['fronthost', 'instructor', 'studio_admin']),
  studioId: Id,
  studioName: z.string().optional(),
})
const AcceptInviteBody = z.object({
  studioId: Id,
  role: z.string().min(1),
  invitedEmail: z.string().email(),
  token: z.string().min(1),
})
const InstructorPayParams = z.object({ instructorId: Id })
const InstructorPayBody = z.object({ payRatePerHeadCents: z.number().int().min(0).nullable().optional() })
const HourlyPayBody = z.object({ payRateHourlyCents: z.number().int().min(0).nullable() })

// ── Invite token helpers ─────────────────────────────────────────────────────

function getInviteSecret(): string {
  return process.env.INVITE_SECRET ?? process.env.ICAL_SECRET ?? 'dev-invite-secret'
}

function generateInviteToken(email: string, studioId: string, role: string): string {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000 // 7 days
  const payload = `${email}|${studioId}|${role}|${expiresAt}`
  const sig = createHmac('sha256', getInviteSecret()).update(payload).digest('hex')
  return Buffer.from(`${payload}|${sig}`).toString('base64url')
}

function verifyInviteToken(token: string, email: string, studioId: string, role: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split('|')
    if (parts.length !== 5) return false
    const [tEmail, tStudioId, tRole, expiresAtStr, sig] = parts
    if (tEmail !== email || tStudioId !== studioId || tRole !== role) return false
    if (Date.now() > parseInt(expiresAtStr, 10)) return false
    const payload = `${tEmail}|${tStudioId}|${tRole}|${expiresAtStr}`
    const expected = createHmac('sha256', getInviteSecret()).update(payload).digest('hex')
    const sigBuf = Buffer.from(sig, 'hex')
    const expBuf = Buffer.from(expected, 'hex')
    if (sigBuf.length !== expBuf.length) return false
    return timingSafeEqual(sigBuf, expBuf)
  } catch {
    return false
  }
}

const requireStudioAdmin = requireRole('studio_admin')

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SUPABASE_URL = process.env.SUPABASE_URL!
const STAFF_PHOTO_BUCKET = 'instructor-photos' // Supabase bucket — also stores staff avatars

const VALID_STAFF_ROLES = ['fronthost', 'instructor'] as const
type StaffRole = typeof VALID_STAFF_ROLES[number]
const VALID_INVITE_ROLES = [...VALID_STAFF_ROLES, 'studio_admin'] as const

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
    {
      preHandler: requireStudioAdmin,
      schema: { querystring: StaffListQuery },
    },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')

      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const staff = await prisma.member.findMany({
        where: { studioIds: { has: studioId }, staffRoles: { hasSome: [...VALID_STAFF_ROLES] } },
        include: {
          user: {
            select: {
              firstName: true, lastName: true, email: true, avatarUrl: true,
              instructors: { where: { studioId }, select: { id: true, payRatePerHeadCents: true } },
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      })

      return staff.map(s => ({
        id: s.id,
        userId: s.userId,
        name: `${s.user.firstName} ${s.user.lastName}`,
        email: s.user.email,
        staffRoles: s.staffRoles,
        joinedAt: s.joinedAt.toISOString(),
        instructorId: s.user.instructors[0]?.id ?? null,
        payRatePerHeadCents: s.user.instructors[0]?.payRatePerHeadCents ?? null,
        payRateHourlyCents: s.payRateHourlyCents ?? null,
        avatarUrl: s.user.avatarUrl ?? null,
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
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

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
      const primaryRole = getPrimaryRole(newRoles)

      await setSupabaseAppMeta(targetUser.id, { role: primaryRole, roles: newRoles, studioIds: newIds })
      // Revoke existing sessions so the user must re-authenticate with the new (elevated) role.
      // Their current JWT still reflects the old role until they log back in.
      revokeUserSessions(targetUser.id).catch(err => console.warn('[staff] session revocation on grant failed:', err))

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

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.STAFF_ROLE_ADD, targetId: targetUser.id, studioId, meta: { email, staffRole, roles: newRoles } })
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
      if (!await assertStudioAccess(user.id, user.role, studioToRemove, reply, user.studioIds)) return

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
        const primaryRole = getPrimaryRole(remainingRoles)
        const newStudios = remainingStudios.length > 0 ? remainingStudios : [studioToRemove]
        await setSupabaseAppMeta(member.user.id, { role: primaryRole, roles: remainingRoles, studioIds: newStudios })
        await prisma.member.update({
          where: { id: memberId },
          data: { studioId: newStudios[0], staffRoles: remainingRoles, studioIds: newStudios },
        })
        if (removingInstructor) {
          await prisma.instructor.deleteMany({ where: { userId: member.user.id, studioId: studioToRemove } })
        }
        // If instructor role is kept, the per-studio Instructor record stays as-is
      }

      // Revoke all active sessions so the user must re-authenticate with their new
      // (reduced) role. Non-fatal — role change in app_metadata is authoritative.
      revokeUserSessions(member.user.id).catch(err =>
        console.warn('[staff] session revocation failed:', err),
      )

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.STAFF_ROLE_REMOVE, targetId: memberId, studioId: studioToRemove, meta: { roleRemoved: roleToRemove ?? 'all', remainingRoles } })
      return reply.send({ success: true, remainingRoles, remainingStudios: remainingStudios.length })
    },
  )

  // POST /staff/invite — send an invitation email to a prospective staff member (studio_admin+)
  // Body: { email, firstName, role: 'fronthost' | 'instructor', studioId }
  app.post<{ Body: { email: string; firstName: string; role: string; studioId: string } }>(
    '/invite',
    {
      preHandler: requireStudioAdmin,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: { body: InviteBody },
    },
    async (request, reply) => {
      const { email, firstName, role, studioId } = request.body
      const user = getUser(request)

      if (!email || !firstName || !studioId) return reply.badRequest('email, firstName, and studioId are required')
      if (!(VALID_INVITE_ROLES as readonly string[]).includes(role)) {
        return reply.badRequest('role must be fronthost, instructor, or studio_admin')
      }
      if (!await assertStudioAccess(user.id, user.role, studioId, reply, user.studioIds)) return

      const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { name: true } })
      if (!studio) return reply.notFound('Studio not found')

      const inviterUser = await prisma.user.findUnique({ where: { id: user.id }, select: { firstName: true, lastName: true } })
      const inviterName = inviterUser ? `${inviterUser.firstName} ${inviterUser.lastName}` : 'A studio admin'

      const webUrl = process.env.WEB_URL ?? 'http://localhost:3001'
      const inviteToken = generateInviteToken(email, studioId, role)
      const signupUrl = `${webUrl}/accept-invite?email=${encodeURIComponent(email)}&studio=${encodeURIComponent(studio.name)}&studioId=${studioId}&role=${role}&token=${inviteToken}`

      await sendStaffInvite({
        to: email,
        firstName,
        studioName: studio.name,
        role,
        inviterName,
        signupUrl,
        webUrl,
      })

      return reply.send({ success: true, message: `Invitation sent to ${email}` })
    },
  )

  // POST /staff/accept-invite — authenticated user accepts their invite and gets their role applied
  // Called client-side immediately after signup/login on the /accept-invite page.
  app.post<{ Body: { studioId: string; role: string; invitedEmail: string; token: string } }>(
    '/accept-invite',
    {
      preHandler: requireAuth,
      schema: { body: AcceptInviteBody },
    },
    async (request, reply) => {
      const { studioId, role, invitedEmail, token } = request.body
      const user = getUser(request)

      if (!studioId || !role || !invitedEmail || !token) return reply.badRequest('studioId, role, invitedEmail, and token are required')
      if (!(VALID_INVITE_ROLES as readonly string[]).includes(role)) {
        return reply.badRequest('Invalid role')
      }

      // Verify the HMAC invite token — proves a real invite was issued for this email/studio/role
      if (!verifyInviteToken(token, invitedEmail, studioId, role)) {
        return reply.code(403).send({ error: 'Invalid or expired invite token' })
      }

      // Verify the authenticated user's email matches the invited email
      const dbUser = await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })
      if (!dbUser || dbUser.email.toLowerCase() !== invitedEmail.toLowerCase()) {
        return reply.forbidden('This invitation was sent to a different email address')
      }

      const studio = await prisma.studio.findUnique({ where: { id: studioId }, select: { id: true, name: true } })
      if (!studio) return reply.notFound('Studio not found')

      const current = await getSupabaseAppMeta(user.id)
      const existingRoles: string[] = current.roles ?? (current.role && current.role !== 'member' ? [current.role as string] : [])
      const existingIds: string[] = current.studioIds ?? []

      const newRoles = [...new Set([...existingRoles, role])]
      const newIds = [...new Set([...existingIds, studioId])]
      const primaryRole = getPrimaryRole(newRoles)

      await setSupabaseAppMeta(user.id, { role: primaryRole, roles: newRoles, studioIds: newIds })
      // Revoke existing sessions — user must log back in to receive a JWT with the new role.
      revokeUserSessions(user.id).catch(err => console.warn('[staff] session revocation on accept-invite failed:', err))

      const existingMember = await prisma.member.findUnique({ where: { userId: user.id } })
      if (existingMember) {
        await prisma.member.update({
          where: { userId: user.id },
          data: { staffRoles: newRoles, studioIds: newIds, studioId: existingMember.studioId ?? studioId },
        })
      } else {
        await prisma.member.create({
          data: { userId: user.id, studioId, staffRoles: newRoles, studioIds: newIds, source: 'invite' },
        })
      }

      return reply.send({ success: true, role: primaryRole, studioName: studio.name })
    },
  )

  // PATCH /staff/instructors/:instructorId — update instructor pay rate (franchise_admin only)
  app.patch<{
    Params: { instructorId: string }
    Body: { payRatePerHeadCents?: number | null }
  }>(
    '/instructors/:instructorId',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { params: InstructorPayParams, body: InstructorPayBody },
    },
    async (request, reply) => {
      const { instructorId } = request.params
      const { payRatePerHeadCents } = request.body
      const user = getUser(request)

      const instructor = await prisma.instructor.findUnique({
        where: { id: instructorId },
        select: { studioId: true },
      })
      if (!instructor) return reply.notFound()

      if (!await assertStudioAccess(user.id, user.role, instructor.studioId, reply, user.studioIds)) return

      const updated = await prisma.instructor.update({
        where: { id: instructorId },
        data: { payRatePerHeadCents: payRatePerHeadCents ?? null },
        select: { id: true, payRatePerHeadCents: true },
      })

      return reply.send({ success: true, instructor: updated })
    },
  )

  // PATCH /staff/:memberId/hourly-pay — set hourly pay rate (franchise_admin only)
  app.patch<{
    Params: { memberId: string }
    Body: { payRateHourlyCents: number | null }
  }>(
    '/:memberId/hourly-pay',
    {
      preHandler: requireRole('franchise_admin'),
      schema: { params: MemberIdParam, body: HourlyPayBody },
    },
    async (request, reply) => {
      const { memberId } = request.params
      const { payRateHourlyCents } = request.body
      const user = getUser(request)

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { studioId: true },
      })
      if (!member) return reply.notFound()

      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

      await prisma.member.update({
        where: { id: memberId },
        data: { payRateHourlyCents: payRateHourlyCents ?? null },
      })

      audit({ actorId: user.id, actorRole: user.role, action: AUDIT.STAFF_PAY_UPDATE, targetId: memberId, studioId: member.studioId, meta: { payRateHourlyCents } })
      return reply.send({ success: true })
    },
  )

  // POST /staff/:memberId/avatar — upload headshot for any staff member, sets User.avatarUrl
  app.post<{
    Params: { memberId: string }
    Body: { base64: string; fileName: string; contentType: string }
  }>(
    '/:memberId/avatar',
    { preHandler: requireStudioAdmin, bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const { memberId } = request.params
      const { base64, fileName, contentType } = request.body
      const user = getUser(request)

      if (!base64 || !fileName || !contentType) return reply.badRequest('base64, fileName and contentType are required')

      const member = await prisma.member.findUnique({
        where: { id: memberId },
        select: { userId: true, studioId: true },
      })
      if (!member) return reply.notFound()

      if (!await assertStudioAccess(user.id, user.role, member.studioId, reply, user.studioIds)) return

      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg'
      const storageKey = `avatars/${member.userId}.${ext}`
      const fileBuffer = Buffer.from(base64, 'base64')

      const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${STAFF_PHOTO_BUCKET}/${storageKey}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
          'Content-Type': contentType,
          'x-upsert': 'true',
        },
        body: fileBuffer,
      })

      if (!storageRes.ok) {
        const err = await storageRes.json().catch(() => ({})) as { message?: string }
        return reply.internalServerError(err.message ?? 'Storage upload failed')
      }

      const avatarUrl = `${SUPABASE_URL}/storage/v1/object/public/${STAFF_PHOTO_BUCKET}/${storageKey}?t=${Date.now()}`

      await prisma.user.update({
        where: { id: member.userId },
        data: { avatarUrl },
      })

      return reply.send({ avatarUrl })
    },
  )
}
