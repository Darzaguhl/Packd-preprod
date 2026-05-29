import pino from 'pino'

/**
 * Shared structured logger — all application code should import from here
 * rather than using console.log directly.
 *
 * Fastify's built-in logger (app.log) covers request/response lifecycle.
 * This logger is for application-level events: job results, email sends,
 * Stripe sync, and background tasks.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // Pretty-print in development; emit JSON in production (LOG_LEVEL != 'info' heuristic)
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } }
    : undefined,
})

export type Logger = typeof logger
