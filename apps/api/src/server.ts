import * as Sentry from '@sentry/node'

// Initialise Sentry before anything else so all errors are captured
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'development',
    // Capture 100% of transactions in production; tune down once volume is clear
    tracesSampleRate: 1.0,
  })
}

import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

import { scheduleRoutes } from './routes/schedule.js'
import { classScheduleRoutes } from './routes/schedules.js'
import { bookingRoutes } from './routes/bookings.js'
import { waitlistRoutes } from './routes/waitlist.js'
import { memberRoutes } from './routes/members.js'
import { studioRoutes } from './routes/studios.js'
import { stripeRoutes } from './routes/stripe.js'
import { adminRoutes } from './routes/admin.js'
import { franchiseRoutes } from './routes/franchise.js'
import { roomRoutes } from './routes/rooms.js'
import { integrationRoutes } from './routes/integrations.js'
import { webhookRoutes } from './routes/webhooks.js'
import { staffRoutes } from './routes/staff.js'
import { photoRoutes } from './routes/photos.js'
import { templateRoutes } from './routes/templates.js'
import { productRoutes } from './routes/products.js'
import { membershipRoutes } from './routes/memberships.js'
import { availabilityRoutes } from './routes/availability.js'
import { shiftsRoutes } from './routes/shifts.js'
import { shiftPatternsRoutes } from './routes/shift-patterns.js'
import { promoRoutes } from './routes/promos.js'
import { icalRoutes } from './routes/ical.js'
import { networkRoutes } from './routes/networks.js'
import { brandRoutes } from './routes/brands.js'
import { aiRoutes } from './routes/ai.js'
import { waiverRoutes } from './routes/waivers.js'
import { setupJobs, stopJobs } from './jobs/index.js'
import { prisma } from '@packd/db'

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
      : undefined,
  },
})

await app.register(swagger, {
  openapi: {
    openapi: '3.0.0',
    info: {
      title: 'Packd API',
      description: 'Boutique fitness studio management API',
      version: '1.0.0',
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
})

await app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list', deepLinking: true },
})

await app.register(cors, {
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
  credentials: true,
})

await app.register(sensible)

// Forward unhandled errors to Sentry (4xx are excluded — not application bugs)
app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
  if (process.env.SENTRY_DSN && (!error.statusCode || error.statusCode >= 500)) {
    Sentry.captureException(error)
  }
  reply.send(error)
})

// Rate limiting — 200 req/min per IP for general use, 20 req/min for auth-sensitive routes
await app.register(rateLimit, {
  global: true,
  max: 200,
  timeWindow: '1 minute',
  // Skip rate limiting for health check
  skipOnError: true,
  keyGenerator: (request) => {
    return request.ip
  },
  errorResponseBuilder: (_request, context) => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Try again in ${Math.ceil(context.ttl / 1000)}s`,
  }),
})

// Raw-body capture — Stripe webhook signature verification requires the
// unparsed buffer. We store it on request.rawBody for all JSON requests
// (same parse result, zero overhead for non-webhook routes).
app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
  ;(req as unknown as { rawBody: Buffer }).rawBody = body as Buffer
  const str = (body as Buffer).toString()
  if (!str) { done(null, undefined); return }
  try { done(null, JSON.parse(str)) } catch (e) { done(e as Error) }
})

// Routes
await app.register(studioRoutes, { prefix: '/studios' })
await app.register(scheduleRoutes, { prefix: '/schedule' })
await app.register(bookingRoutes, { prefix: '/bookings' })
await app.register(waitlistRoutes, { prefix: '/waitlist' })
await app.register(memberRoutes, { prefix: '/members' })
await app.register(stripeRoutes, { prefix: '/stripe' })
await app.register(adminRoutes, { prefix: '/admin' })
await app.register(franchiseRoutes, { prefix: '/franchise' })
await app.register(roomRoutes, { prefix: '/rooms' })
await app.register(classScheduleRoutes, { prefix: '/schedules' })
await app.register(integrationRoutes, { prefix: '/integrations' })
await app.register(webhookRoutes, { prefix: '/webhooks' })
await app.register(staffRoutes, { prefix: '/staff' })
await app.register(photoRoutes, { prefix: '/photos' })
await app.register(templateRoutes, { prefix: '/templates' })
await app.register(productRoutes, { prefix: '/products' })
await app.register(membershipRoutes, { prefix: '/memberships' })
await app.register(availabilityRoutes, { prefix: '/availability' })
await app.register(shiftsRoutes, { prefix: '/admin/shifts' })
await app.register(shiftPatternsRoutes, { prefix: '/admin/shift-patterns' })
await app.register(promoRoutes, { prefix: '/promos' })
await app.register(icalRoutes, { prefix: '/ical' })
await app.register(networkRoutes, { prefix: '/networks' })
await app.register(brandRoutes, { prefix: '/brands' })
await app.register(aiRoutes, { prefix: '/ai' })
await app.register(waiverRoutes, { prefix: '/waivers' })

app.get('/health', async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    return { ok: true, db: 'up', ts: new Date().toISOString() }
  } catch (e) {
    reply.code(503)
    return { ok: false, db: 'down', ts: new Date().toISOString() }
  }
})

// Background jobs
await setupJobs()

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
app.log.info(`API running on http://localhost:${port}`)

// Graceful shutdown — drain in-flight requests and pg-boss jobs before exit
const shutdown = async (signal: string) => {
  app.log.info(`[server] ${signal} received — shutting down gracefully`)
  await app.close()
  await stopJobs()
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT',  () => shutdown('SIGINT'))
