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
