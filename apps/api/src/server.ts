import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import rateLimit from '@fastify/rate-limit'

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
import { promoRoutes } from './routes/promos.js'
import { icalRoutes } from './routes/ical.js'
import { networkRoutes } from './routes/networks.js'
import { brandRoutes } from './routes/brands.js'
import { setupJobs } from './jobs/index.js'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
  credentials: true,
})

await app.register(sensible)

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
  try { done(null, JSON.parse((body as Buffer).toString())) } catch (e) { done(e as Error) }
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
await app.register(promoRoutes, { prefix: '/promos' })
await app.register(icalRoutes, { prefix: '/ical' })
await app.register(networkRoutes, { prefix: '/networks' })
await app.register(brandRoutes, { prefix: '/brands' })

app.get('/health', async () => ({ ok: true }))

// Background jobs
await setupJobs()

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
console.log(`API running on http://localhost:${port}`)
