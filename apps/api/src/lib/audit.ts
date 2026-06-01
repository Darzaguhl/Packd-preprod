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
  SHIFT_CREATE:          'shift.create',
  SHIFT_UPDATE:          'shift.update',
  SHIFT_DELETE:          'shift.delete',
  SHIFT_PATTERN_CREATE:  'shift.pattern.create',
  SHIFT_PATTERN_UPDATE:  'shift.pattern.update',
  SHIFT_PATTERN_DELETE:  'shift.pattern.delete',
  STAFF_ROLE_ADD:        'staff.role.add',
  STAFF_ROLE_REMOVE:     'staff.role.remove',
  STAFF_PAY_UPDATE:      'staff.pay.update',
  SCHEDULE_CREATE:       'schedule.create',
  SCHEDULE_DELETE:       'schedule.delete',
  SCHEDULE_BULK:         'schedule.bulk',
  SESSION_CANCEL:        'session.cancel',
  SESSION_RESCHEDULE:    'session.reschedule',
  SESSION_CHECKIN:       'session.checkin',
  BOOKING_CANCEL_ADMIN:  'booking.cancel.admin',
} as const
