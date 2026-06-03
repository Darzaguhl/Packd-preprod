import type { FastifyReply } from 'fastify'
import { prisma } from '@packd/db'
import { ROLE_RANK, type UserRole } from '@packd/types'

/**
 * admin/franchise_admin: unrestricted.
 * staff (instructor/fronthost) with studioId in JWT app_metadata: checked against the JWT value (no DB roundtrip).
 * All others: must have a Member record for this studio.
 * Returns false and sends 403 if access is denied — callers must `return` on false.
 */
export async function assertStudioAccess(
  userId: string,
  role: UserRole,
  studioId: string,
  replyOrStudioIds?: FastifyReply | string[],
  jwtStudioIds?: string[],
): Promise<boolean> {
  // Resolve overloaded 4th argument: may be reply (old callers) or studioIds array (new callers)
  let reply: FastifyReply | undefined
  let resolvedStudioIds: string[] | undefined

  if (Array.isArray(replyOrStudioIds) || replyOrStudioIds === undefined) {
    resolvedStudioIds = replyOrStudioIds as string[] | undefined
  } else {
    reply = replyOrStudioIds as FastifyReply
    resolvedStudioIds = jwtStudioIds
  }

  if (ROLE_RANK[role] >= ROLE_RANK['franchise_admin']) return true
  if (resolvedStudioIds !== undefined) {
    if (resolvedStudioIds.includes(studioId)) return true
    reply?.forbidden('Access denied to this studio')
    return false
  }
  const member = await prisma.member.findUnique({ where: { userId }, select: { studioId: true } })
  if (!member || member.studioId !== studioId) {
    reply?.forbidden('Access denied to this studio')
    return false
  }
  return true
}

/**
 * Returns true if the instructor already has a non-cancelled session overlapping
 * the given time window. Optionally exclude a specific session (e.g. the one being rescheduled).
 */
export async function checkInstructorConflict(
  instructorId: string,
  startsAt: Date,
  endsAt: Date,
  excludeSessionId?: string,
): Promise<boolean> {
  if (!instructorId) return false
  const conflict = await prisma.classSession.findFirst({
    where: {
      instructorId,
      status: { not: 'CANCELLED' },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
    },
    select: { id: true },
  })
  return conflict !== null
}

/**
 * Validate that a SQL string is a safe read-only SELECT (or WITH…SELECT) query.
 * Returns an error message string if invalid, or null if OK.
 */
export function validateSelectQuery(sql: string): string | null {
  if (!sql.trim()) return 'Query cannot be empty'

  const stripped = sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (!stripped.startsWith('select') && !stripped.startsWith('with')) {
    return 'Only SELECT (and WITH … SELECT) queries are allowed'
  }

  const forbiddenKeywords = /\b(insert\s+into|update\s+\w|delete\s+from|drop\s+|create\s+|alter\s+|truncate\s+|grant\s+|revoke\s+|pg_read_file|pg_write_file|pg_read_binary_file|lo_import|lo_export)\b/
  const forbiddenFunctions = /\b(execute|dblink|pg_sleep|set_config|current_setting)\s*\(/
  const forbidden = { test: (s: string) => forbiddenKeywords.test(s) || forbiddenFunctions.test(s) }
  if (forbidden.test(stripped)) {
    return 'Query contains forbidden keywords (DML/DDL is not allowed)'
  }

  if (/\bcopy\b.*\bto\b/s.test(stripped) || /\bcopy\b.*\bfrom\b/s.test(stripped)) {
    return 'COPY … TO/FROM is not allowed'
  }

  const withoutTrailingSemicolon = stripped.replace(/;\s*$/, '')
  if (withoutTrailingSemicolon.includes(';')) {
    return 'Multiple statements are not allowed'
  }

  return null
}
