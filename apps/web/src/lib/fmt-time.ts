export type TimeFormat = '12h' | '24h'

/**
 * Format a Date or ISO string for display in the given timezone.
 * 12h → "7:30 AM"  |  24h → "07:30"
 * timeZone defaults to the browser local zone if omitted.
 */
export function fmtTime(date: Date | string, format: TimeFormat, timeZone?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const tz = timeZone ? { timeZone } : {}
  if (format === '12h') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, ...tz })
  }
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, ...tz })
}

/**
 * Format a Date or ISO string as a short date+time for display.
 * e.g. "Mon 26 May, 09:00" in the given timezone.
 */
export function fmtDateTime(date: Date | string, format: TimeFormat, timeZone?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const tz = timeZone ? { timeZone } : {}
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...tz })
  const timeStr = fmtTime(d, format, timeZone)
  return `${dateStr}, ${timeStr}`
}

/**
 * Format a "HH:MM" schedule time string (e.g. "07:30") for display.
 * 12h → "7:30 AM"  |  24h → "07:30" (unchanged)
 */
export function fmtHHMM(hhmm: string, format: TimeFormat): string {
  if (format === '24h') return hhmm
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
}
