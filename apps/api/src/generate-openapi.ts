/**
 * Generate OpenAPI spec from the live Fastify route registrations.
 *
 * Usage: npx tsx src/generate-openapi.ts
 * Output: openapi.json (in the apps/api directory)
 *
 * This script builds the Fastify app (registers all routes + swagger) without
 * starting the HTTP server or connecting to the DB. The swagger plugin collects
 * route schemas via the onRoute hook — no real DB or Stripe calls happen.
 *
 * Run this whenever route schemas change, then commit the updated openapi.json.
 * CI checks that the committed spec matches what this script would produce.
 */

// Stub env vars so auth.ts and stripe.ts don't throw at import time
process.env.SUPABASE_URL       ??= 'https://stub.supabase.co'
process.env.DATABASE_URL       ??= 'postgresql://stub:stub@localhost:5432/stub'
process.env.STRIPE_SECRET_KEY  ??= 'sk_test_stub'
process.env.STRIPE_WEBHOOK_SECRET ??= 'whsec_stub'
process.env.RESEND_API_KEY     ??= 're_stub'
process.env.ICAL_SECRET        ??= 'stub-secret'

import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import sensible from '@fastify/sensible'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from '@fastify/type-provider-zod'
import { studioAccessPlugin } from './lib/studio-access-plugin.js'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// All route plugins
import { scheduleRoutes }      from './routes/schedule.js'
import { classScheduleRoutes } from './routes/schedules.js'
import { bookingRoutes }       from './routes/bookings.js'
import { waitlistRoutes }      from './routes/waitlist.js'
import { memberRoutes }        from './routes/members.js'
import { studioRoutes }        from './routes/studios.js'
import { stripeRoutes }        from './routes/stripe.js'
import { adminRoutes }         from './routes/admin.js'
import { franchiseRoutes }     from './routes/franchise.js'
import { roomRoutes }          from './routes/rooms.js'
import { integrationRoutes }   from './routes/integrations.js'
import { webhookRoutes }       from './routes/webhooks.js'
import { staffRoutes }         from './routes/staff.js'
import { photoRoutes }         from './routes/photos.js'
import { templateRoutes }      from './routes/templates.js'
import { productRoutes }       from './routes/products.js'
import { membershipRoutes }    from './routes/memberships.js'
import { availabilityRoutes }  from './routes/availability.js'
import { shiftsRoutes }        from './routes/shifts.js'
import { shiftPatternsRoutes } from './routes/shift-patterns.js'
import { promoRoutes }         from './routes/promos.js'
import { icalRoutes }          from './routes/ical.js'
import { networkRoutes }       from './routes/networks.js'
import { brandRoutes }         from './routes/brands.js'
import { aiRoutes }            from './routes/ai.js'
import { waiverRoutes }        from './routes/waivers.js'

const app = Fastify({ logger: false })

app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)

await app.register(swagger, {
  openapi: {
    openapi: '3.0.0',
    info: { title: 'Packd API', description: 'Boutique fitness studio management API', version: '1.0.0' },
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    security: [{ bearerAuth: [] }],
  },
  transform: jsonSchemaTransform,
})

await app.register(sensible)
await app.register(studioAccessPlugin)

// Register all routes (same prefixes as server.ts)
await app.register(studioRoutes,        { prefix: '/studios' })
await app.register(scheduleRoutes,      { prefix: '/schedule' })
await app.register(bookingRoutes,       { prefix: '/bookings' })
await app.register(waitlistRoutes,      { prefix: '/waitlist' })
await app.register(memberRoutes,        { prefix: '/members' })
await app.register(stripeRoutes,        { prefix: '/stripe' })
await app.register(adminRoutes,         { prefix: '/admin' })
await app.register(franchiseRoutes,     { prefix: '/franchise' })
await app.register(roomRoutes,          { prefix: '/rooms' })
await app.register(classScheduleRoutes, { prefix: '/schedules' })
await app.register(membershipRoutes,    { prefix: '/memberships' })
await app.register(integrationRoutes,   { prefix: '/integrations' })
await app.register(webhookRoutes,       { prefix: '/webhooks' })
await app.register(staffRoutes,         { prefix: '/staff' })
await app.register(photoRoutes,         { prefix: '/photos' })
await app.register(templateRoutes,      { prefix: '/templates' })
await app.register(productRoutes,       { prefix: '/products' })
await app.register(availabilityRoutes,  { prefix: '/availability' })
await app.register(shiftsRoutes,        { prefix: '/admin/shifts' })
await app.register(shiftPatternsRoutes, { prefix: '/admin/shift-patterns' })
await app.register(promoRoutes,         { prefix: '/promos' })
await app.register(icalRoutes,          { prefix: '/ical' })
await app.register(networkRoutes,       { prefix: '/networks' })
await app.register(brandRoutes,         { prefix: '/brands' })
await app.register(aiRoutes,            { prefix: '/ai' })
await app.register(waiverRoutes,        { prefix: '/waivers' })

app.get('/health', async () => ({ ok: true }))

// Finalise without binding to a port
await app.ready()

const spec = app.swagger()

const __dir = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(__dir, '..', 'openapi.json')
writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n')

console.log(`✓ OpenAPI spec written to ${outPath}`)
console.log(`  ${Object.keys((spec as { paths: object }).paths ?? {}).length} paths`)
await app.close()
