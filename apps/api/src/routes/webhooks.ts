import type { FastifyInstance } from 'fastify'
import { createHmac, timingSafeEqual } from 'crypto'
import { prisma } from '@packd/db'

// Mariana Tek signs webhook payloads with HMAC-SHA256.
// Signature arrives as "sha256=<hex-digest>" in X-MT-Signature header.
function verifySignature(rawBody: Buffer, secret: string, header: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`
  if (expected.length !== header.length) return false
  return timingSafeEqual(Buffer.from(expected), Buffer.from(header))
}

export async function webhookRoutes(app: FastifyInstance) {
  // Register a raw body parser scoped to this plugin only.
  // Other route plugins are unaffected — they keep Fastify's default JSON parser.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    try {
      done(null, body)
    } catch (e) {
      done(e as Error)
    }
  })

  // POST /webhooks/mariana-tek
  // Mariana Tek sends events here; we verify the signature then dispatch by event type.
  app.post<{ Headers: { 'x-mt-signature'?: string; 'x-mt-studio-id'?: string } }>(
    '/mariana-tek',
    async (request, reply) => {
      const rawBody = request.body as Buffer
      const signature = request.headers['x-mt-signature'] ?? ''
      const studioSlug = request.headers['x-mt-studio-id'] ?? ''

      if (!studioSlug) return reply.code(400).send({ error: 'Missing X-MT-Studio-Id header' })

      // Look up the integration config to get the per-studio webhook secret
      const studio = await prisma.studio.findUnique({
        where: { slug: studioSlug },
        include: { integration: { select: { webhookSecret: true, syncEnabled: true } } },
      })

      if (!studio?.integration?.webhookSecret) {
        // Return 200 to prevent Mariana Tek from retrying — just not configured yet
        return reply.send({ ok: true, ignored: 'integration not configured' })
      }

      if (!studio.integration.syncEnabled) {
        return reply.send({ ok: true, ignored: 'sync disabled' })
      }

      if (!verifySignature(rawBody, studio.integration.webhookSecret, signature)) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }

      let event: { type: string; data: Record<string, unknown> }
      try {
        event = JSON.parse(rawBody.toString('utf8'))
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON body' })
      }

      await handleEvent(studio.id, event.type, event.data)

      return reply.send({ ok: true })
    },
  )
}

async function handleEvent(
  studioId: string,
  type: string,
  data: Record<string, unknown>,
) {
  switch (type) {
    case 'member.created':
    case 'member.updated':
      await handleMemberUpsert(studioId, data)
      break

    case 'booking.created':
      await handleBookingCreated(studioId, data)
      break

    case 'booking.cancelled':
      await handleBookingCancelled(data)
      break

    case 'class_occurrence.created':
    case 'class_occurrence.updated':
      // Session sync is handled by the scheduled import job, not individual webhooks,
      // because template/room resolution requires additional API calls.
      // Log for now; implement when Mariana Tek API access is confirmed.
      console.log(`[webhook] ${type} received for studio ${studioId} — queued for next sync`)
      break

    default:
      console.log(`[webhook] unhandled event type: ${type}`)
  }
}

async function handleMemberUpsert(studioId: string, data: Record<string, unknown>) {
  const externalId = String(data.id ?? '')
  if (!externalId) return

  // We can update metadata on an already-synced member.
  // We cannot create a new member here because that requires a Supabase user to exist first.
  // New member creation goes through the scheduled sync job which handles auth user provisioning.
  await prisma.member.updateMany({
    where: { studioId, externalId },
    data: {
      // notes field used to store any sync metadata until a dedicated field is added
      notes: data.notes ? String(data.notes) : undefined,
    },
  })
}

async function handleBookingCreated(studioId: string, data: Record<string, unknown>) {
  const externalBookingId = String(data.id ?? '')
  const externalMemberId = String(data.user_id ?? '')
  const externalSessionId = String(data.class_occurrence_id ?? '')
  if (!externalBookingId || !externalMemberId || !externalSessionId) return

  const [member, session] = await Promise.all([
    prisma.member.findUnique({ where: { studioId_externalId: { studioId, externalId: externalMemberId } } }),
    prisma.classSession.findUnique({ where: { studioId_externalId: { studioId, externalId: externalSessionId } } }),
  ])

  if (!member || !session) {
    console.log(`[webhook] booking.created: member or session not found (m:${externalMemberId} s:${externalSessionId})`)
    return
  }

  await prisma.booking.upsert({
    where: { externalId: externalBookingId },
    create: {
      sessionId: session.id,
      memberId: member.id,
      status: 'CONFIRMED',
      externalId: externalBookingId,
      source: 'mariana_tek',
    },
    update: { status: 'CONFIRMED' },
  })
}

async function handleBookingCancelled(data: Record<string, unknown>) {
  const externalBookingId = String(data.id ?? '')
  if (!externalBookingId) return

  await prisma.booking.updateMany({
    where: { externalId: externalBookingId },
    data: { status: 'CANCELLED' },
  })
}
