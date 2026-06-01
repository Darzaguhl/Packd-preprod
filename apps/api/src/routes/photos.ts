import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireAuth, requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const BUCKET = 'instructor-photos'

// Users at studio_admin rank or above — or fronthosts — can manage any instructor's photos.
// Fronthosts share rank 2 with instructors so we can't use rank alone; check explicitly.
function isManager(role: string) {
  return ROLE_RANK[role as keyof typeof ROLE_RANK] >= ROLE_RANK['studio_admin'] || role === 'fronthost'
}

// Verify the caller can act on this instructor's photos:
// - The instructor themselves (matched by userId on the Instructor record)
// - A studio/franchise manager
async function assertPhotoAccess(
  callerId: string,
  callerRole: string,
  instructorId: string,
): Promise<'owner' | 'manager' | null> {
  if (isManager(callerRole)) return 'manager'
  const instructor = await prisma.instructor.findUnique({
    where: { id: instructorId },
    select: { userId: true },
  })
  if (instructor?.userId === callerId) return 'owner'
  return null
}

export async function photoRoutes(app: FastifyInstance) {

  // GET /photos/instructors/:instructorId
  // List all photos for an instructor (instructor sees own; managers see any)
  app.get<{ Params: { instructorId: string } }>(
    '/instructors/:instructorId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { instructorId } = request.params
      const user = getUser(request)

      const access = await assertPhotoAccess(user.id, user.role, instructorId)
      if (!access) return reply.forbidden()

      // Always expand to ALL instructor records for this user — a user can have one
      // Instructor record per studio, so photos uploaded in one studio context must
      // appear when listing via any of their other instructor IDs.
      const baseUserId = access === 'owner'
        ? user.id
        : (await prisma.instructor.findUnique({ where: { id: instructorId }, select: { userId: true } }))?.userId

      const allInstructors = baseUserId
        ? await prisma.instructor.findMany({ where: { userId: baseUserId }, select: { id: true } })
        : [{ id: instructorId }]

      const photoWhere = { instructorId: { in: allInstructors.map(i => i.id) } }

      const photos = await prisma.instructorPhoto.findMany({
        where: photoWhere,
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(photos)
    },
  )

  // POST /photos/instructors/:instructorId/upload
  // Upload a photo server-side: client sends base64, API streams to Supabase, saves DB record.
  // bodyLimit raised to 15 MB to accommodate base64-encoded 10 MB images (~33% overhead).
  app.post<{
    Params: { instructorId: string }
    Body: { base64: string; fileName: string; contentType: string }
  }>(
    '/instructors/:instructorId/upload',
    { preHandler: requireAuth, bodyLimit: 15 * 1024 * 1024 },
    async (request, reply) => {
      const { instructorId } = request.params
      const { base64, fileName, contentType } = request.body
      const user = getUser(request)

      if (!base64 || !fileName || !contentType) return reply.badRequest('base64, fileName and contentType are required')

      const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
      const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp']
      if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        return reply.badRequest('Invalid content type. Allowed: image/jpeg, image/png, image/gif, image/webp')
      }
      const fileExt = fileName.split('.').pop()?.toLowerCase() ?? ''
      if (!ALLOWED_EXTENSIONS.includes(fileExt)) {
        return reply.badRequest('Invalid file extension. Allowed: jpg, jpeg, png, gif, webp')
      }

      const access = await assertPhotoAccess(user.id, user.role, instructorId)
      if (!access) return reply.forbidden()

      const instructor = await prisma.instructor.findUnique({
        where: { id: instructorId },
        select: { studioId: true },
      })
      if (!instructor) return reply.notFound('Instructor not found')

      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg'
      const storageKey = `${instructorId}/${crypto.randomUUID()}.${ext}`
      const fileBuffer = Buffer.from(base64, 'base64')

      // Upload directly to Supabase Storage using service role key
      const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storageKey}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
          'Content-Type': contentType,
          'x-upsert': 'false',
        },
        body: fileBuffer,
      })

      if (!storageRes.ok) {
        const err = await storageRes.json().catch(() => ({})) as { message?: string }
        return reply.internalServerError(err.message ?? 'Storage upload failed')
      }

      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storageKey}`

      const photo = await prisma.instructorPhoto.create({
        data: {
          instructorId,
          studioId: instructor.studioId,
          storageKey,
          url: publicUrl,
          fileName,
          uploadedBy: user.id,
          approvedForSocial: false,
        },
      })

      return reply.code(201).send(photo)
    },
  )

  // PATCH /photos/instructors/:instructorId/:photoId
  // Toggle approvedForSocial — instructor (owner) or manager
  app.patch<{
    Params: { instructorId: string; photoId: string }
    Body: { approvedForSocial: boolean }
  }>(
    '/instructors/:instructorId/:photoId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { instructorId, photoId } = request.params
      const { approvedForSocial } = request.body
      const user = getUser(request)

      if (typeof approvedForSocial !== 'boolean') return reply.badRequest('approvedForSocial must be a boolean')

      const access = await assertPhotoAccess(user.id, user.role, instructorId)
      if (!access) return reply.forbidden()

      const photo = await prisma.instructorPhoto.findUnique({
        where: { id: photoId },
      })
      if (!photo) return reply.notFound()

      // Accept photos stored under any instructor record belonging to the same user —
      // a user can have one Instructor record per studio, so a photo uploaded in one
      // studio context must still be patchable via another studio's instructor ID.
      const baseUserId = access === 'owner'
        ? user.id
        : (await prisma.instructor.findUnique({ where: { id: instructorId }, select: { userId: true } }))?.userId

      if (!baseUserId) return reply.notFound()

      const allInstructors = await prisma.instructor.findMany({
        where: { userId: baseUserId },
        select: { id: true },
      })
      if (!allInstructors.some(i => i.id === photo.instructorId)) return reply.notFound()

      const updated = await prisma.instructorPhoto.update({
        where: { id: photoId },
        data: { approvedForSocial },
      })

      return reply.send(updated)
    },
  )

  // DELETE /photos/instructors/:instructorId/:photoId
  // Only the instructor (owner) can delete — managers cannot
  app.delete<{ Params: { instructorId: string; photoId: string } }>(
    '/instructors/:instructorId/:photoId',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { instructorId, photoId } = request.params
      const user = getUser(request)

      // Only the instructor themselves can delete.
      // Verify ownership via the instructorId param first, then confirm the photo
      // belongs to ANY of their instructor records (multi-studio users may have
      // photos stored under a different record than the one in the URL).
      const instructor = await prisma.instructor.findUnique({
        where: { id: instructorId },
        select: { userId: true },
      })
      if (!instructor) return reply.notFound()
      if (instructor.userId !== user.id) return reply.forbidden()

      // Collect all instructor IDs for this user so we can find the photo regardless
      // of which studio context it was uploaded under.
      const allInstructors = await prisma.instructor.findMany({
        where: { userId: user.id },
        select: { id: true },
      })
      const instructorIds = allInstructors.map(i => i.id)

      const photo = await prisma.instructorPhoto.findUnique({ where: { id: photoId } })
      if (!photo || !instructorIds.includes(photo.instructorId)) return reply.notFound()

      // Delete from Supabase Storage
      await fetch(
        `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${photo.storageKey}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            apikey: SERVICE_ROLE_KEY,
          },
        },
      )

      await prisma.instructorPhoto.delete({ where: { id: photoId } })

      return reply.send({ success: true })
    },
  )

  // GET /photos/studios/:studioId/approved
  // All approved-for-social photos across all instructors in a studio.
  // Photos are matched by instructor identity (userId), not the photo's studioId stamp,
  // so photos uploaded in another studio context are included for multi-studio instructors.
  // Accessible to any authenticated staff member assigned to the studio.
  app.get<{ Params: { studioId: string } }>(
    '/studios/:studioId/approved',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studioId } = request.params
      const user = getUser(request)

      // Verify the caller belongs to this studio (or is a global admin)
      const member = await prisma.member.findFirst({
        where: { userId: user.id, studioIds: { has: studioId } },
      })
      const isGlobalAdmin = ROLE_RANK[user.role as keyof typeof ROLE_RANK] >= ROLE_RANK['franchise_admin']
      if (!member && !isGlobalAdmin) return reply.forbidden()

      // Find instructors who teach at this studio, then expand to ALL their
      // instructor records (a user can have one per studio) so photos uploaded
      // in any studio context are included.
      const studioInstructors = await prisma.instructor.findMany({
        where: { studioId },
        select: { userId: true },
      })
      const userIds = studioInstructors.map(i => i.userId)

      const allInstructorIds = (await prisma.instructor.findMany({
        where: { userId: { in: userIds } },
        select: { id: true },
      })).map(i => i.id)

      const photos = await prisma.instructorPhoto.findMany({
        where: {
          instructorId: { in: allInstructorIds },
          approvedForSocial: true,
        },
        include: {
          instructor: {
            include: { user: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      return reply.send(photos.map(p => ({
        ...p,
        instructorName: `${p.instructor.user.firstName} ${p.instructor.user.lastName}`,
        instructor: undefined,
      })))
    },
  )
}
