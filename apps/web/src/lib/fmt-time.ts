export type TimeFormat = '12h' | '24h'

/**
 * Format a Date or ISO string for display.
 * 12h → "7:30 AM"  |  24h → "07:30"
 */
export function fmtTime(date: Date | string, format: TimeFormat): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (format === '12h') {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
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
