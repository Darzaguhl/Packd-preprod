import { prisma } from '@packd/db'

interface AuditParams {
  actorId: string
  actorRole: string
  action: string
  targetId?: string
  studioId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>
}

/**
 * Write a fire-and-forget audit log entry.
 * Non-fatal — never throws; failures are swallowed so they never break the
 * main request flow.
 */
export function audit(params: AuditParams): void {
  prisma.auditLog.create({ data: params }).catch(() => {})
}

// ─── Well-known action constants ─────────────────────────────────────────────
export const AUDIT = {
  CREDIT_ADJUST:       'credit.adjust',
  CREDIT_GRANT:        'credit.grant',
  BOOKING_CANCEL:      'booking.cancel',
  REFUND_ISSUE:        'refund.issue',
  MEMBER_NOTE_DELETE:  'member.note.delete',
  PLAN_ASSIGN:         'membership.assign',
  PLAN_CANCEL:         'membership.cancel',
  PAUSE_SUBSCRIPTION:  'membership.pause',
  RESUME_SUBSCRIPTION: 'membership.resume',
  STRIPE_REPLAY:       'stripe.replay',
  GUEST_CHECKIN:       'guest.checkin',
  GUEST_PASS_GRANT:    'guest.pass.grant',
  PROMO_REDEEM:        'promo.redeem',
} as const
