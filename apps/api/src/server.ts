import Fastify from 'fastify'
import cors from '@fastify/cors'
import sensible from '@fastify/sensible'

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
import { setupJobs } from './jobs/index.js'

const app = Fastify({ logger: true })

await app.register(cors, {
  origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','),
  credentials: true,
})

await app.register(sensible)

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

app.get('/health', async () => ({ ok: true }))

// Background jobs
await setupJobs()

const port = Number(process.env.PORT ?? 4000)
await app.listen({ port, host: '0.0.0.0' })
console.log(`API running on http://localhost:${port}`)
