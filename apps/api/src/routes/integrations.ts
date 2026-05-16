import type { FastifyInstance } from 'fastify'
import { prisma } from '@packd/db'
import { requireRole, getUser } from '../lib/auth.js'
import { ROLE_RANK } from '@packd/types'

const requireStudioAdmin = requireRole('studio_admin')

// Minimal AES-256-GCM encrypt/decrypt for the API key at rest.
// Key is derived from the INTEGRATION_SECRET env var (must be 32 bytes hex).
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ALGO = 'aes-256-gcm'

function getEncKey(): Buffer {
  const hex = process.env.INTEGRATION_SECRET ?? ''
  if (hex.length !== 64) throw new Error('INTEGRATION_SECRET must be a 64-char hex string (32 bytes)')
  return Buffer.from(hex, 'hex')
}

function encryptApiKey(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, getEncKey(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), enc.toString('hex'), tag.toString('hex')].join('.')
}

function decryptApiKey(stored: string): string {
  const [ivHex, encHex, tagHex] = stored.split('.')
  const decipher = createDecipheriv(ALGO, getEncKey(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8')
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

export async function integrationRoutes(app: FastifyInstance) {
  // GET /integrations/config?studioId= — get current integration config (studio_admin+)
  app.get<{ Querystring: { studioId: string } }>(
    '/config',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId } = request.query
      if (!studioId) return reply.badRequest('studioId is required')
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId)) return reply.forbidden()

      const integration = await prisma.studioIntegration.findUnique({ where: { studioId } })
      if (!integration) return reply.send(null)

      return reply.send({
        provider: integration.provider,
        syncEnabled: integration.syncEnabled,
        lastSyncedAt: integration.lastSyncedAt,
        hasApiKey: !!integration.apiKeyEnc,
        hasWebhookSecret: !!integration.webhookSecret,
      })
    },
  )

  // POST /integrations/config — save/update integration credentials (studio_admin+)
  app.post<{
    Body: { studioId: string; provider: string; apiKey: string; webhookSecret?: string; syncEnabled?: boolean }
  }>(
    '/config',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, provider, apiKey, webhookSecret, syncEnabled = false } = request.body
      if (!studioId || !provider || !apiKey) {
        return reply.badRequest('studioId, provider, and apiKey are required')
      }
      if (provider !== 'mariana_tek') {
        return reply.badRequest('Unsupported provider. Only "mariana_tek" is supported.')
      }
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId)) return reply.forbidden()

      let apiKeyEnc: string
      try {
        apiKeyEnc = encryptApiKey(apiKey)
      } catch {
        return reply.internalServerError('INTEGRATION_SECRET not configured on server')
      }

      const integration = await prisma.studioIntegration.upsert({
        where: { studioId },
        create: { studioId, provider, apiKeyEnc, webhookSecret, syncEnabled },
        update: { provider, apiKeyEnc, webhookSecret, syncEnabled },
      })

      return reply.send({ success: true, provider: integration.provider, syncEnabled: integration.syncEnabled })
    },
  )

  // POST /integrations/mariana-tek/sync/members — idempotent upsert of members from Mariana Tek
  // Expects an array of Mariana Tek user objects already translated to Packd shape.
  // The caller (a sync job or migration script) is responsible for resolving userId (Supabase).
  app.post<{
    Body: {
      studioId: string
      members: Array<{
        externalId: string       // Mariana Tek member ID
        userId: string           // already-created Supabase user ID
        firstName: string
        lastName: string
        email: string
        creditBalance?: number
        joinedAt?: string
      }>
    }
  }>(
    '/mariana-tek/sync/members',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, members } = request.body
      if (!studioId || !Array.isArray(members) || members.length === 0) {
        return reply.badRequest('studioId and a non-empty members array are required')
      }
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId)) return reply.forbidden()

      if (members.length > 500) return reply.badRequest('Maximum 500 members per batch')

      const results = await Promise.allSettled(
        members.map(async (m) => {
          await prisma.member.upsert({
            where: { studioId_externalId: { studioId, externalId: m.externalId } },
            create: {
              userId: m.userId,
              studioId,
              externalId: m.externalId,
              source: 'mariana_tek',
              joinedAt: m.joinedAt ? new Date(m.joinedAt) : undefined,
            },
            update: {
              // Don't overwrite userId or studioId — those are structural
            },
          })

          if (m.creditBalance !== undefined && m.creditBalance > 0) {
            const member = await prisma.member.findUnique({
              where: { studioId_externalId: { studioId, externalId: m.externalId } },
              select: { id: true },
            })
            if (member) {
              await prisma.creditBalance.upsert({
                where: { memberId: member.id },
                create: { memberId: member.id, balance: m.creditBalance },
                update: { balance: m.creditBalance },
              })
            }
          }

          return m.externalId
        }),
      )

      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results
        .map((r, i) => ({ r, externalId: members[i].externalId }))
        .filter(({ r }) => r.status === 'rejected')
        .map(({ externalId, r }) => ({
          externalId,
          error: (r as PromiseRejectedResult).reason?.message ?? 'unknown',
        }))

      return reply.send({ success: true, succeeded, failed })
    },
  )

  // POST /integrations/mariana-tek/sync/sessions — idempotent upsert of class sessions
  app.post<{
    Body: {
      studioId: string
      sessions: Array<{
        externalId: string      // Mariana Tek class occurrence ID
        templateId: string      // must exist in Packd
        instructorId: string    // must exist in Packd
        roomId: string          // must exist in Packd
        startsAt: string
        endsAt: string
        capacity: number
        creditsRequired?: number
      }>
    }
  }>(
    '/mariana-tek/sync/sessions',
    { preHandler: requireStudioAdmin },
    async (request, reply) => {
      const { studioId, sessions } = request.body
      if (!studioId || !Array.isArray(sessions) || sessions.length === 0) {
        return reply.badRequest('studioId and a non-empty sessions array are required')
      }
      const user = getUser(request)
      if (!await assertStudioAccess(user.id, user.role, studioId)) return reply.forbidden()

      if (sessions.length > 200) return reply.badRequest('Maximum 200 sessions per batch')

      const results = await Promise.allSettled(
        sessions.map(s =>
          prisma.classSession.upsert({
            where: { studioId_externalId: { studioId, externalId: s.externalId } },
            create: {
              studioId,
              templateId: s.templateId,
              instructorId: s.instructorId,
              roomId: s.roomId,
              startsAt: new Date(s.startsAt),
              endsAt: new Date(s.endsAt),
              capacity: s.capacity,
              creditsRequired: s.creditsRequired ?? 1,
              externalId: s.externalId,
              source: 'mariana_tek',
            },
            update: {
              startsAt: new Date(s.startsAt),
              endsAt: new Date(s.endsAt),
              capacity: s.capacity,
              creditsRequired: s.creditsRequired ?? 1,
            },
          }),
        ),
      )

      const succeeded = results.filter(r => r.status === 'fulfilled').length
      const failed = results
        .map((r, i) => ({ r, externalId: sessions[i].externalId }))
        .filter(({ r }) => r.status === 'rejected')
        .map(({ externalId, r }) => ({
          externalId,
          error: (r as PromiseRejectedResult).reason?.message ?? 'unknown',
        }))

      return reply.send({ success: true, succeeded, failed })
    },
  )
}
