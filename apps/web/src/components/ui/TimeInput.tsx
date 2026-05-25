'use client'

import { useTimeFormat } from '@/lib/time-format-context'

interface Props {
  value: string                        // always HH:MM (24h internal format)
  onChange: (value: string) => void    // always returns HH:MM
  className?: string
  disabled?: boolean
}

/**
 * Time picker that respects the studio time format setting.
 * - 24h mode: plain text input showing HH:MM (avoids OS locale AM/PM override)
 * - 12h mode: native <input type="time"> which shows AM/PM on US locale
 * Internal value is always HH:MM regardless of display mode.
 */
export default function TimeInput({ value, onChange, className = '', disabled }: Props) {
  const timeFormat = useTimeFormat()

  if (timeFormat === '24h') {
    return (
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={e => {
          // allow free typing, only emit valid HH:MM
          const raw = e.target.value
          onChange(raw)
        }}
        onBlur={e => {
          // Normalise on blur: accept "7:30", "730", "07:30" → "07:30"
          const raw = e.target.value.replace(/[^\d:]/g, '')
          const noColon = raw.replace(':', '')
          if (noColon.length >= 3) {
            const h = noColon.length === 3 ? noColon.slice(0, 1) : noColon.slice(0, 2)
            const m = noColon.length === 3 ? noColon.slice(1) : noColon.slice(2, 4)
            const hh = String(Math.min(parseInt(h) || 0, 23)).padStart(2, '0')
            const mm = String(Math.min(parseInt(m) || 0, 59)).padStart(2, '0')
            onChange(`${hh}:${mm}`)
          }
        }}
        placeholder="HH:MM"
        disabled={disabled}
        className={className}
      />
    )
  }

  return (
    <input
      type="time"
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className={className}
    />
  )
}
