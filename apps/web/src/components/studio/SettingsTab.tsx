'use client'

import { useState, useEffect } from 'react'
import { api, type StudioDetail } from '@/lib/api'

const TIMEZONES: { group: string; zones: string[] }[] = [
  { group: 'Europe', zones: [
    'Europe/London', 'Europe/Dublin', 'Europe/Lisbon',
    'Europe/Paris', 'Europe/Berlin', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen',
    'Europe/Amsterdam', 'Europe/Brussels', 'Europe/Zurich', 'Europe/Vienna', 'Europe/Rome',
    'Europe/Madrid', 'Europe/Prague', 'Europe/Warsaw', 'Europe/Budapest', 'Europe/Bucharest',
    'Europe/Athens', 'Europe/Helsinki', 'Europe/Riga', 'Europe/Tallinn', 'Europe/Vilnius',
    'Europe/Istanbul', 'Europe/Moscow', 'Europe/Kiev',
  ]},
  { group: 'Americas', zones: [
    'America/New_York', 'America/Toronto', 'America/Montreal',
    'America/Chicago', 'America/Winnipeg',
    'America/Denver', 'America/Edmonton', 'America/Phoenix',
    'America/Los_Angeles', 'America/Vancouver',
    'America/Anchorage', 'Pacific/Honolulu',
    'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
    'America/Santiago', 'America/Bogota', 'America/Lima',
    'America/Mexico_City', 'America/Cancun',
  ]},
  { group: 'Asia / Middle East', zones: [
    'Asia/Dubai', 'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Bahrain', 'Asia/Qatar',
    'Asia/Tehran', 'Asia/Karachi', 'Asia/Kolkata', 'Asia/Colombo',
    'Asia/Dhaka', 'Asia/Rangoon', 'Asia/Bangkok', 'Asia/Ho_Chi_Minh',
    'Asia/Jakarta', 'Asia/Kuala_Lumpur', 'Asia/Singapore',
    'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Shanghai', 'Asia/Seoul', 'Asia/Tokyo',
  ]},
  { group: 'Africa', zones: [
    'Africa/Casablanca', 'Africa/Lagos', 'Africa/Johannesburg',
    'Africa/Nairobi', 'Africa/Cairo', 'Africa/Addis_Ababa',
  ]},
  { group: 'Pacific / Oceania', zones: [
    'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin',
    'Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Hobart',
    'Pacific/Auckland', 'Pacific/Fiji', 'Pacific/Guam',
  ]},
  { group: 'UTC', zones: ['UTC'] },
]

const CURRENCIES = [
  'AED', 'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP',
  'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK',
  'NZD', 'PHP', 'PLN', 'QAR', 'RON', 'SAR', 'SEK', 'SGD', 'THB', 'TRY',
  'TWD', 'UAH', 'USD', 'ZAR',
]

interface Props {
  studioId: string
  token: string
  onNameChange?: (name: string) => void
  onStudioUpdate?: (data: { name: string; timezone: string; currency: string; timeFormat: string }) => void
}

export default function SettingsTab({ studioId, token, onNameChange, onStudioUpdate }: Props) {
  const [studio, setStudio] = useState<StudioDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  // Studio fields
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [timezone, setTimezone] = useState('')
  const [currency, setCurrency] = useState('')
  const [timeFormat, setTimeFormat] = useState<'12h' | '24h'>('24h')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [supportEmail, setSupportEmail] = useState('')
  // Booking settings
  const [bookingWindowDays, setBookingWindowDays] = useState(30)
  const [bookingCloseHours, setBookingCloseHours] = useState(1)
  // Feature toggles
  const [waitlistEnabled, setWaitlistEnabled] = useState(true)
  const [guestCheckInEnabled, setGuestCheckInEnabled] = useState(true)
  const [creditPurchaseEnabled, setCreditPurchaseEnabled] = useState(true)
  const [selfCheckInEnabled, setSelfCheckInEnabled] = useState(false)
  // Class reminder
  const [classReminderEnabled, setClassReminderEnabled] = useState(true)
  const [classReminderHours, setClassReminderHours] = useState(24)
  // Membership pause rules
  const [maxPauseDays, setMaxPauseDays] = useState(30)
  const [maxPausesPerYear, setMaxPausesPerYear] = useState(2)

  // Location fields (first location)
  const [locName, setLocName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')

  // Cancellation policy fields
  const [policyLoading, setPolicyLoading] = useState(true)
  const [policySaving, setPolicySaving] = useState(false)
  const [lateCancelWindowHours, setLateCancelWindowHours]   = useState(12)
  const [lateCancelFeeCredits,  setLateCancelFeeCredits]    = useState(1)
  const [noShowFeeCredits,      setNoShowFeeCredits]         = useState(1)
  const [waitlistWindowMinutes, setWaitlistWindowMinutes]   = useState(15)
  // Saved state for dirty-check
  const [savedPolicy, setSavedPolicy] = useState({ lateCancelWindowHours: 12, lateCancelFeeCredits: 1, noShowFeeCredits: 1, waitlistWindowMinutes: 15 })

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    api.studios.get(studioId, token).then(s => {
      setStudio(s)
      setName(s.name)
      setSlug(s.slug)
      setTimezone(s.timezone)
      setCurrency(s.currency)
      setTimeFormat((s.timeFormat ?? '24h') as '12h' | '24h')
      setWebsiteUrl((s as typeof s & { websiteUrl?: string }).websiteUrl ?? '')
      setSupportEmail((s as typeof s & { supportEmail?: string }).supportEmail ?? '')
      setBookingWindowDays((s as typeof s & { bookingWindowDays?: number }).bookingWindowDays ?? 30)
      setBookingCloseHours((s as typeof s & { bookingCloseHours?: number }).bookingCloseHours ?? 1)
      setWaitlistEnabled((s as typeof s & { waitlistEnabled?: boolean }).waitlistEnabled ?? true)
      setGuestCheckInEnabled((s as typeof s & { guestCheckInEnabled?: boolean }).guestCheckInEnabled ?? true)
      setCreditPurchaseEnabled((s as typeof s & { creditPurchaseEnabled?: boolean }).creditPurchaseEnabled ?? true)
      setSelfCheckInEnabled((s as typeof s & { selfCheckInEnabled?: boolean }).selfCheckInEnabled ?? false)
      const reminderHours = (s as typeof s & { classReminderHours?: number | null }).classReminderHours
      setClassReminderEnabled(reminderHours !== null)
      setClassReminderHours(reminderHours ?? 24)
      setMaxPauseDays((s as typeof s & { maxPauseDays?: number }).maxPauseDays ?? 30)
      setMaxPausesPerYear((s as typeof s & { maxPausesPerYear?: number }).maxPausesPerYear ?? 2)
      const loc = s.locations[0]
      if (loc) {
        setLocName(loc.name)
        setAddress(loc.address)
        setCity(loc.city)
        setCountry(loc.country)
      }
    }).finally(() => setLoading(false))

    api.studios.getPolicy(studioId, token).then(p => {
      setLateCancelWindowHours(p.lateCancelWindowHours)
      setLateCancelFeeCredits(p.lateCancelFeeCredits)
      setNoShowFeeCredits(p.noShowFeeCredits)
      setWaitlistWindowMinutes(p.waitlistWindowMinutes)
      setSavedPolicy(p)
    }).catch(() => {}).finally(() => setPolicyLoading(false))
  }, [studioId, token])

  function handleNameChange(val: string) {
    setName(val)
    // auto-update slug only if slug still matches the old name pattern
    const autoSlug = studio?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') ?? ''
    if (slug === autoSlug) {
      setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    }
  }

  async function handleSave() {
    if (!studio) return
    setSaving(true)
    try {
      const loc = studio.locations[0]
      type StudioExtended = typeof studio & { websiteUrl?: string; supportEmail?: string; bookingWindowDays?: number; bookingCloseHours?: number; waitlistEnabled?: boolean; guestCheckInEnabled?: boolean; creditPurchaseEnabled?: boolean; selfCheckInEnabled?: boolean; classReminderHours?: number | null; maxPauseDays?: number; maxPausesPerYear?: number }
      const s = studio as StudioExtended
      const newReminderHours = classReminderEnabled ? classReminderHours : null
      const res = await api.studios.update(studioId, {
        name: name !== studio.name ? name : undefined,
        slug: slug !== studio.slug ? slug : undefined,
        timezone: timezone !== studio.timezone ? timezone : undefined,
        currency: currency !== studio.currency ? currency : undefined,
        timeFormat: timeFormat !== (studio.timeFormat ?? '24h') ? timeFormat : undefined,
        websiteUrl: websiteUrl !== (s.websiteUrl ?? '') ? (websiteUrl || null) : undefined,
        supportEmail: supportEmail !== (s.supportEmail ?? '') ? (supportEmail || null) : undefined,
        bookingWindowDays: bookingWindowDays !== (s.bookingWindowDays ?? 30) ? bookingWindowDays : undefined,
        bookingCloseHours: bookingCloseHours !== (s.bookingCloseHours ?? 1) ? bookingCloseHours : undefined,
        waitlistEnabled: waitlistEnabled !== (s.waitlistEnabled ?? true) ? waitlistEnabled : undefined,
        guestCheckInEnabled: guestCheckInEnabled !== (s.guestCheckInEnabled ?? true) ? guestCheckInEnabled : undefined,
        creditPurchaseEnabled: creditPurchaseEnabled !== (s.creditPurchaseEnabled ?? true) ? creditPurchaseEnabled : undefined,
        selfCheckInEnabled: selfCheckInEnabled !== (s.selfCheckInEnabled ?? false) ? selfCheckInEnabled : undefined,
        classReminderHours: newReminderHours !== (s.classReminderHours ?? 24) ? newReminderHours : undefined,
        maxPauseDays: maxPauseDays !== (s.maxPauseDays ?? 30) ? maxPauseDays : undefined,
        maxPausesPerYear: maxPausesPerYear !== (s.maxPausesPerYear ?? 2) ? maxPausesPerYear : undefined,
        location: loc ? {
          id: loc.id,
          name: locName !== loc.name ? locName : undefined,
          address: address !== loc.address ? address : undefined,
          city: city !== loc.city ? city : undefined,
          country: country !== loc.country ? country : undefined,
        } : undefined,
      }, token)
      setStudio(res.studio)
      onNameChange?.(res.studio.name)
      onStudioUpdate?.({ name: res.studio.name, timezone: res.studio.timezone, currency: res.studio.currency, timeFormat: res.studio.timeFormat ?? '24h' })
      showToast('Settings saved')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save', false)
    } finally {
      setSaving(false)
    }
  }

  async function handleSavePolicy() {
    setPolicySaving(true)
    try {
      const updated = await api.studios.updatePolicy(studioId, {
        lateCancelWindowHours,
        lateCancelFeeCredits,
        noShowFeeCredits,
        waitlistWindowMinutes,
      }, token)
      setSavedPolicy(updated)
      showToast('Cancellation policy saved')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save policy', false)
    } finally {
      setPolicySaving(false)
    }
  }

  const isPolicyDirty =
    lateCancelWindowHours  !== savedPolicy.lateCancelWindowHours  ||
    lateCancelFeeCredits   !== savedPolicy.lateCancelFeeCredits   ||
    noShowFeeCredits        !== savedPolicy.noShowFeeCredits       ||
    waitlistWindowMinutes  !== savedPolicy.waitlistWindowMinutes

  type StudioExt = typeof studio & { websiteUrl?: string; supportEmail?: string; bookingWindowDays?: number; bookingCloseHours?: number; waitlistEnabled?: boolean; guestCheckInEnabled?: boolean; creditPurchaseEnabled?: boolean; selfCheckInEnabled?: boolean; classReminderHours?: number | null; maxPauseDays?: number; maxPausesPerYear?: number }
  const s2 = studio as StudioExt | null
  const isDirty = studio && (
    name !== studio.name ||
    slug !== studio.slug ||
    timezone !== studio.timezone ||
    currency !== studio.currency ||
    timeFormat !== (studio.timeFormat ?? '24h') ||
    websiteUrl !== (s2?.websiteUrl ?? '') ||
    supportEmail !== (s2?.supportEmail ?? '') ||
    bookingWindowDays !== (s2?.bookingWindowDays ?? 30) ||
    bookingCloseHours !== (s2?.bookingCloseHours ?? 1) ||
    waitlistEnabled !== (s2?.waitlistEnabled ?? true) ||
    guestCheckInEnabled !== (s2?.guestCheckInEnabled ?? true) ||
    creditPurchaseEnabled !== (s2?.creditPurchaseEnabled ?? true) ||
    selfCheckInEnabled !== (s2?.selfCheckInEnabled ?? false) ||
    (classReminderEnabled ? classReminderHours : null) !== (s2?.classReminderHours ?? 24) ||
    maxPauseDays !== (s2?.maxPauseDays ?? 30) ||
    maxPausesPerYear !== (s2?.maxPausesPerYear ?? 2) ||
    locName !== (studio.locations[0]?.name ?? '') ||
    address !== (studio.locations[0]?.address ?? '') ||
    city !== (studio.locations[0]?.city ?? '') ||
    country !== (studio.locations[0]?.country ?? '')
  )

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => <div key={i} className="h-12 bg-gray-50 rounded-xl animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* Studio identity */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Studio</h3>

        <div className="space-y-1">
          <label className="text-xs text-gray-500 font-medium">Name</label>
          <input
            value={name}
            onChange={e => handleNameChange(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-500 font-medium">Slug</label>
          <input
            value={slug}
            onChange={e => setSlug(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 font-mono"
          />
          <p className="text-[10px] text-gray-400">Used in URLs — lowercase letters, numbers and hyphens only</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium">Timezone</label>
            <select
              value={timezone}
              onChange={e => setTimezone(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            >
              {TIMEZONES.map(group => (
                <optgroup key={group.group} label={group.group}>
                  {group.zones.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium">Currency</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
            >
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs text-gray-500 font-medium">Time format</label>
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
            {(['24h', '12h'] as const).map(fmt => (
              <button
                key={fmt}
                onClick={() => setTimeFormat(fmt)}
                className={`text-sm px-4 py-1.5 rounded-md font-medium transition-colors ${
                  timeFormat === fmt
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {fmt === '24h' ? '24h (14:30)' : '12h (2:30 PM)'}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Contact & branding */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact &amp; branding</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 font-medium">Website URL</label>
            <input
              className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={websiteUrl}
              onChange={e => setWebsiteUrl(e.target.value)}
              placeholder="https://mystudio.com"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Support email</label>
            <input
              type="email"
              className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={supportEmail}
              onChange={e => setSupportEmail(e.target.value)}
              placeholder="hello@mystudio.com"
            />
          </div>
        </div>
      </section>

      {/* Booking policy */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Booking policy</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 font-medium">Booking window (days)</label>
            <p className="text-[10px] text-gray-400 mb-1">How far in advance members can book</p>
            <input
              type="number"
              min="1"
              max="365"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={bookingWindowDays}
              onChange={e => setBookingWindowDays(parseInt(e.target.value) || 30)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Booking close (hours before)</label>
            <p className="text-[10px] text-gray-400 mb-1">Booking closes N hours before class starts</p>
            <input
              type="number"
              min="0"
              max="72"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={bookingCloseHours}
              onChange={e => setBookingCloseHours(parseInt(e.target.value) || 0)}
            />
          </div>
        </div>
      </section>

      {/* Feature toggles */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Features</h3>
        <div className="space-y-2">
          {([
            { label: 'Waitlist', description: 'Allow members to join the waitlist when a class is full', value: waitlistEnabled, set: setWaitlistEnabled },
            { label: 'Guest check-in', description: 'Staff can check in guests using member guest passes', value: guestCheckInEnabled, set: setGuestCheckInEnabled },
            { label: 'Online credit purchase', description: 'Members can buy plans and credits via Stripe on their account page', value: creditPurchaseEnabled, set: setCreditPurchaseEnabled },
            { label: 'Member self check-in', description: 'Members can check themselves in from their account page', value: selfCheckInEnabled, set: setSelfCheckInEnabled },
          ] as const).map(({ label, description, value, set }) => (
            <label key={label} className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl hover:bg-gray-50 transition-colors">
              <input
                type="checkbox"
                checked={value}
                onChange={e => (set as (v: boolean) => void)(e.target.checked)}
                className="mt-0.5 rounded"
              />
              <span>
                <span className="text-sm font-medium text-gray-900 block">{label}</span>
                <span className="text-xs text-gray-400">{description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {/* Class reminder */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Class reminder email</h3>
        <label className="flex items-start gap-3 cursor-pointer select-none p-3 rounded-xl hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={classReminderEnabled}
            onChange={e => setClassReminderEnabled(e.target.checked)}
            className="mt-0.5 rounded"
          />
          <span>
            <span className="text-sm font-medium text-gray-900 block">Send class reminders</span>
            <span className="text-xs text-gray-400">Email members before their upcoming class</span>
          </span>
        </label>
        {classReminderEnabled && (
          <div>
            <label className="text-xs text-gray-500 font-medium">Send reminder (hours before class)</label>
            <input
              type="number"
              min="1"
              max="168"
              className="mt-1 w-32 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={classReminderHours}
              onChange={e => setClassReminderHours(parseInt(e.target.value) || 24)}
            />
          </div>
        )}
      </section>

      {/* Membership pause rules */}
      <section className="space-y-3">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Membership pause rules</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 font-medium">Max pause duration (days)</label>
            <input
              type="number"
              min="1"
              max="365"
              className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={maxPauseDays}
              onChange={e => setMaxPauseDays(parseInt(e.target.value) || 30)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-medium">Max pauses per year</label>
            <input
              type="number"
              min="1"
              max="12"
              className="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
              value={maxPausesPerYear}
              onChange={e => setMaxPausesPerYear(parseInt(e.target.value) || 2)}
            />
          </div>
        </div>
      </section>

      {/* Location */}
      {studio?.locations[0] && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Location</h3>

          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium">Location name</label>
            <input
              value={locName}
              onChange={e => setLocName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-500 font-medium">Address</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Street address"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">City</label>
              <input
                value={city}
                onChange={e => setCity(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">Country</label>
              <input
                value={country}
                onChange={e => setCountry(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>
        </section>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {isDirty && (
          <button
            onClick={() => {
              if (!studio) return
              setName(studio.name); setSlug(studio.slug)
              setTimezone(studio.timezone); setCurrency(studio.currency)
              setTimeFormat((studio.timeFormat ?? '24h') as '12h' | '24h')
              const loc = studio.locations[0]
              if (loc) { setLocName(loc.name); setAddress(loc.address); setCity(loc.city); setCountry(loc.country) }
            }}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            Discard
          </button>
        )}
      </div>

      {/* ── Cancellation Policy ─────────────────────────────────────── */}
      <section className="space-y-4 pt-4 border-t border-gray-100">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancellation Policy</h3>
          <p className="text-xs text-gray-400 mt-0.5">Rules applied when members cancel bookings or fail to show up.</p>
        </div>

        {policyLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-xl animate-pulse" />)}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Late cancel window */}
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">Late cancel window</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={lateCancelWindowHours}
                  onChange={e => setLateCancelWindowHours(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums"
                />
                <span className="text-sm text-gray-500">hours before class</span>
              </div>
              <p className="text-[10px] text-gray-400">Cancellations within this window are treated as late cancels.</p>
            </div>

            {/* Fees grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-gray-500 font-medium">Late cancel fee</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={lateCancelFeeCredits}
                    onChange={e => setLateCancelFeeCredits(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums"
                  />
                  <span className="text-sm text-gray-500">cr</span>
                </div>
                <p className="text-[10px] text-gray-400">0 = no additional fee</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-gray-500 font-medium">No-show fee</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={noShowFeeCredits}
                    onChange={e => setNoShowFeeCredits(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums"
                  />
                  <span className="text-sm text-gray-500">cr</span>
                </div>
                <p className="text-[10px] text-gray-400">Charged when session ends without check-in</p>
              </div>
            </div>

            {/* Waitlist window */}
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">Waitlist confirmation window</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={waitlistWindowMinutes}
                  onChange={e => setWaitlistWindowMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums"
                />
                <span className="text-sm text-gray-500">minutes to confirm</span>
              </div>
              <p className="text-[10px] text-gray-400">How long a promoted waitlist member has to confirm their spot.</p>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={handleSavePolicy}
                disabled={policySaving || !isPolicyDirty}
                className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
              >
                {policySaving ? 'Saving…' : 'Save policy'}
              </button>
              {isPolicyDirty && (
                <button
                  onClick={() => {
                    setLateCancelWindowHours(savedPolicy.lateCancelWindowHours)
                    setLateCancelFeeCredits(savedPolicy.lateCancelFeeCredits)
                    setNoShowFeeCredits(savedPolicy.noShowFeeCredits)
                    setWaitlistWindowMinutes(savedPolicy.waitlistWindowMinutes)
                  }}
                  className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Discard
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
