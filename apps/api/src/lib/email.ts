import { Resend } from 'resend'
import { logger } from './logger.js'

const FROM = process.env.EMAIL_FROM ?? 'onboarding@resend.dev'

// Lazy-initialise so tests that don't set RESEND_API_KEY don't blow up at import time.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY!)
  return _resend
}

/** Send an email. Non-fatal — logs error and returns false on failure. */
async function send(to: string, subject: string, html: string): Promise<boolean> {
  try {
    await getResend().emails.send({ from: FROM, to, subject, html })
    return true
  } catch (e) {
    logger.error({ err: e, to, subject }, '[email] send failed')
    return false
  }
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(studioName: string, body: string) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 0">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <tr><td style="background:#111;padding:24px 32px">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700">${studioName}</p>
        </td></tr>
        <tr><td style="padding:32px">
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #f0f0f0">
          <p style="margin:0;font-size:12px;color:#999">You're receiving this because you're a member of ${studioName}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function btn(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;margin-top:20px;background:#111;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none">${label}</a>`
}

function formatDt(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ─── Email senders ────────────────────────────────────────────────────────────

export async function sendWaitlistPromotion(opts: {
  to: string
  firstName: string
  studioName: string
  className: string
  startsAt: string
  webUrl: string
}) {
  return send(
    opts.to,
    `You're in — ${opts.className}`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">You're off the waitlist! 🎉</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, a spot just opened up and you've been confirmed for:</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#111">${opts.className}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">${formatDt(opts.startsAt)}</p>
      </div>
      ${btn(opts.webUrl + '/schedule', 'View my bookings')}
    `),
  )
}

export async function sendBookingConfirmation(opts: {
  to: string
  firstName: string
  studioName: string
  className: string
  startsAt: string
  roomName: string
  stationLabel?: string | null
  webUrl: string
}) {
  return send(
    opts.to,
    `Booking confirmed — ${opts.className}`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Booking confirmed ✓</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, you're booked in for:</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#111">${opts.className}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">${formatDt(opts.startsAt)}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">${opts.roomName}${opts.stationLabel ? ` · Spot ${opts.stationLabel}` : ''}</p>
      </div>
      ${btn(opts.webUrl + '/account', 'View booking')}
    `),
  )
}

export async function sendBookingCancellation(opts: {
  to: string
  firstName: string
  studioName: string
  className: string
  startsAt: string
  reason?: string
  webUrl: string
}) {
  return send(
    opts.to,
    `Booking cancelled — ${opts.className}`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Booking cancelled</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, your booking has been cancelled:</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#111">${opts.className}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">${formatDt(opts.startsAt)}</p>
        ${opts.reason ? `<p style="margin:8px 0 0;font-size:13px;color:#888">${opts.reason}</p>` : ''}
      </div>
      ${btn(opts.webUrl + '/schedule', 'Browse classes')}
    `),
  )
}

export async function sendClassReminder(opts: {
  to: string
  firstName: string
  studioName: string
  className: string
  startsAt: string
  instructorName: string
  roomName: string
  stationLabel?: string | null
  webUrl: string
}) {
  return send(
    opts.to,
    `Reminder: ${opts.className} tomorrow`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">See you tomorrow! 👋</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, just a reminder about your class:</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#111">${opts.className}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">${formatDt(opts.startsAt)}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">With ${opts.instructorName} · ${opts.roomName}${opts.stationLabel ? ` · Spot ${opts.stationLabel}` : ''}</p>
      </div>
      ${btn(opts.webUrl + '/account', 'View booking')}
    `),
  )
}

export async function sendWelcome(opts: {
  to: string
  firstName: string
  studioName: string
  planName: string
  webUrl: string
}) {
  return send(
    opts.to,
    `Welcome to ${opts.studioName}!`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Welcome, ${opts.firstName}! 🎉</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Your <strong>${opts.planName}</strong> membership is now active. You're all set to start booking classes.</p>
      ${btn(opts.webUrl + '/schedule', 'Browse classes')}
    `),
  )
}

export async function sendPaymentFailed(opts: {
  to: string
  studioName: string
  memberFirstName: string
  memberEmail: string
  amountFormatted: string
  manageUrl: string
}) {
  return send(
    opts.to,
    `Payment failed — ${opts.memberFirstName} (${opts.memberEmail})`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#c00">Payment failed ⚠️</p>
      <p style="margin:0 0 16px;font-size:15px;color:#555">A membership payment of <strong>${opts.amountFormatted}</strong> failed for member <strong>${opts.memberFirstName}</strong> (${opts.memberEmail}). Their subscription has been marked as <strong>Past Due</strong>.</p>
      <div style="background:#fff8f8;border:1px solid #fcc;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:14px;color:#555">The member will receive a payment retry attempt from Stripe. You can also manage their subscription directly in your dashboard.</p>
      </div>
      ${btn(opts.manageUrl, 'View member in dashboard')}
    `),
  )
}

export async function sendStaffInvite(opts: {
  to: string
  firstName: string
  studioName: string
  role: string
  inviterName: string
  signupUrl: string
  webUrl: string
}) {
  const roleLabel = opts.role === 'instructor' ? 'Instructor' : 'Front Desk'
  return send(
    opts.to,
    `You're invited to join ${opts.studioName} on Packd`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">You've been invited! 🎉</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, ${opts.inviterName} has invited you to join <strong>${opts.studioName}</strong> as a <strong>${roleLabel}</strong> on Packd.</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:14px;color:#555">1. Create your account using the button below</p>
        <p style="margin:8px 0 0;font-size:14px;color:#555">2. Your ${roleLabel} role will be activated by ${opts.inviterName}</p>
        <p style="margin:8px 0 0;font-size:14px;color:#555">3. Log in to start managing classes</p>
      </div>
      ${btn(opts.signupUrl, 'Accept invitation')}
      <p style="margin:16px 0 0;font-size:12px;color:#aaa">Or copy this link: ${opts.signupUrl}</p>
    `),
  )
}

export async function sendFranchiseBroadcast(opts: {
  to: string
  firstName: string
  studioName: string
  subject: string
  message: string
  webUrl: string
}) {
  return send(
    opts.to,
    opts.subject,
    layout(opts.studioName, `
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName},</p>
      <p style="margin:0;font-size:15px;color:#333;white-space:pre-line">${opts.message}</p>
      ${btn(opts.webUrl + '/schedule', 'View schedule')}
    `),
  )
}

export async function sendSessionAnnouncement(opts: {
  to: string
  firstName: string
  studioName: string
  className: string
  startsAt: string
  subject: string
  message: string
  webUrl: string
}) {
  return send(
    opts.to,
    `${opts.subject} — ${opts.className}`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">${opts.subject}</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName},</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:16px">
        <p style="margin:0;font-size:15px;font-weight:600;color:#111">${opts.className}</p>
        <p style="margin:4px 0 0;font-size:13px;color:#888">${formatDt(opts.startsAt)}</p>
      </div>
      <p style="margin:0;font-size:15px;color:#333;white-space:pre-line">${opts.message}</p>
      ${btn(opts.webUrl + '/schedule', 'View schedule')}
    `),
  )
}

export async function sendWinback(opts: {
  to: string
  firstName: string
  studioName: string
  webUrl: string
}) {
  return send(
    opts.to,
    `We miss you at ${opts.studioName}!`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">We miss you, ${opts.firstName}!</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">It's been a while since your last class. Ready to get back on the floor?</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Browse our upcoming sessions and find a time that works for you.</p>
      ${btn(opts.webUrl + '/schedule', 'Browse classes')}
    `),
  )
}

export async function sendCreditExpiryWarning(opts: {
  to: string
  firstName: string
  studioName: string
  credits: number
  expiresAt: Date
  webUrl: string
}) {
  const expiryStr = opts.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  return send(
    opts.to,
    `Your credits expire soon — ${opts.studioName}`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Use your credits before they expire!</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, you have <strong>${opts.credits} credit${opts.credits !== 1 ? 's' : ''}</strong> expiring on <strong>${expiryStr}</strong>.</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Book a class now to make the most of them.</p>
      ${btn(opts.webUrl + '/schedule', 'Book a class')}
    `),
  )
}

export async function sendFirstClassFollowup(opts: {
  to: string
  firstName: string
  studioName: string
  webUrl: string
}) {
  return send(
    opts.to,
    `How was your first class at ${opts.studioName}?`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">How did it go, ${opts.firstName}?</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">We hope you had an amazing first class! We'd love to see you again soon.</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Check out our schedule and book your next session.</p>
      ${btn(opts.webUrl + '/schedule', 'Book your next class')}
    `),
  )
}

export async function sendSubstituteNotification(opts: {
  to: string
  firstName: string
  studioName: string
  className: string
  startsAt: string
  substituteName: string
  webUrl: string
}) {
  return send(
    opts.to,
    `Instructor update — ${opts.className}`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Instructor update</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, the instructor for your upcoming class has changed:</p>
      <div style="background:#f8f8f8;border-radius:8px;padding:16px 20px;margin-bottom:8px">
        <p style="margin:0;font-size:16px;font-weight:600;color:#111">${opts.className}</p>
        <p style="margin:4px 0 0;font-size:14px;color:#666">${formatDt(opts.startsAt)}</p>
        <p style="margin:8px 0 0;font-size:14px;color:#333">Instructor: <strong>${opts.substituteName}</strong></p>
      </div>
      ${btn(opts.webUrl + '/account', 'View booking')}
    `),
  )
}

// ─── Ops alerting ─────────────────────────────────────────────────────────────

/**
 * Send a plain-text ops alert to OPS_EMAIL.
 *
 * Use for failures that require human attention but don't need a fancy template:
 *  - pg-boss job failures
 *  - Stripe webhook processing errors
 *  - Any unhandled server-side error that silently swallows money or credits
 *
 * Non-fatal — never throws. Returns false if OPS_EMAIL isn't configured or send fails.
 */
export async function sendOpsAlert(subject: string, body: string): Promise<boolean> {
  const to = process.env.OPS_EMAIL
  if (!to) {
    logger.warn('[ops-alert] OPS_EMAIL not set — alert suppressed: ' + subject)
    return false
  }
  return send(
    to,
    `[Packd Alert] ${subject}`,
    `<!DOCTYPE html><html><body style="font-family:monospace;padding:24px;background:#fff">
      <h2 style="color:#dc2626;margin:0 0 16px">[Packd Alert] ${subject}</h2>
      <pre style="background:#f5f5f5;padding:16px;border-radius:6px;overflow:auto;font-size:13px;white-space:pre-wrap">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      <p style="color:#666;font-size:12px;margin-top:16px">Sent at ${new Date().toISOString()} · Packd API</p>
    </body></html>`,
  )
}

export async function sendReferralReward(opts: {
  to: string
  firstName: string
  studioName: string
  credits: number
  webUrl: string
}) {
  return send(
    opts.to,
    `You've earned ${opts.credits} credits at ${opts.studioName}!`,
    layout(opts.studioName, `
      <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111">Referral reward! 🎉</p>
      <p style="margin:0 0 20px;font-size:15px;color:#555">Hi ${opts.firstName}, someone you referred just booked their first class. You've earned <strong>${opts.credits} credit${opts.credits !== 1 ? 's' : ''}</strong> as a thank-you!</p>
      ${btn(opts.webUrl + '/account', 'View your credits')}
    `),
  )
}
