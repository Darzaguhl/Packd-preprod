/**
 * Studio context helper — sets `app.current_studio_id` as a Postgres session
 * variable inside a transaction so RLS policies can filter rows automatically.
 *
 * Usage:
 *   const result = await withStudioCtx(studioId, async (tx) => {
 *     return tx.classSession.findMany({ ... })
 *   })
 *
 * The `tx` parameter is a Prisma interactive-transaction client.
 * All queries run through `tx` will see only rows belonging to `studioId`.
 *
 * When `studioId` is empty/undefined the context variable is cleared, which
 * triggers the "soft bypass" RLS clause (allows cross-studio admin queries).
 */

import { prisma, type Prisma } from '@packd/db'

type TxClient = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export async function withStudioCtx<T>(
  studioId: string | null | undefined,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const id = studioId ?? ''
    // Switch to the limited packd_api role so RLS policies are enforced
    // (postgres superuser bypasses RLS even with FORCE ROW LEVEL SECURITY).
    // SET LOCAL is transaction-scoped — safe with PgBouncer transaction-pooling.
    await tx.$executeRawUnsafe('SET LOCAL ROLE packd_api')
    await tx.$executeRaw`SELECT set_config('app.current_studio_id', ${id}, true)`
    return fn(tx)
  })
}

/**
 * Standalone helper — sets the context without wrapping in a transaction.
 * Use when the caller already manages its own transaction.
 * Note: requires a connection in session-mode (not pgBouncer transaction-mode).
 * Prefer `withStudioCtx` for correctness.
 */
export async function setStudioCtx(studioId: string): Promise<void> {
  await prisma.$executeRaw`SELECT set_config('app.current_studio_id', ${studioId}, true)`
}
