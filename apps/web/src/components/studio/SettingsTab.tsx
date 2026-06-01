'use client'

import { useState, useEffect } from 'react'
import { api, waivers as waiversClient } from '@/lib/api-client'
import type { StudioDetail } from '@/lib/api-client'

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

type SettingsPanel = 'general' | 'policies' | 'features' | 'ai'

export default function SettingsTab({ studioId, token, onNameChange, onStudioUpdate }: Props) {
  const [panel, setPanel] = useState<SettingsPanel>('general')
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
  const [allowMemberPause, setAllowMemberPause] = useState(true)
  // Tax / VAT
  const [taxRatePct, setTaxRatePct] = useState(0)
  // Referral
  const [referralRewardCredits, setReferralRewardCredits] = useState(0)
  // Waiver
  const [waiverLoading, setWaiverLoading] = useState(true)
  const [waiverSaving, setWaiverSaving] = useState(false)
  const [existingWaiver, setExistingWaiver] = useState<{ id: string; title: string; body: string; version: number } | null>(null)
  const [waiverTitle, setWaiverTitle] = useState('')
  const [waiverBody, setWaiverBody] = useState('')
  const [waiverEnabled, setWaiverEnabled] = useState(false)

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

  // AI settings
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiHasKey, setAiHasKey] = useState(false)
  const [aiKeySuffix, setAiKeySuffix] = useState<string | null>(null)
  const [aiKeyInput, setAiKeyInput] = useState('')
  const [aiShowKeyInput, setAiShowKeyInput] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)

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
      setAllowMemberPause((s as typeof s & { allowMemberPause?: boolean }).allowMemberPause ?? true)
      setTaxRatePct((s as typeof s & { taxRatePct?: number }).taxRatePct ?? 0)
      setReferralRewardCredits((s as typeof s & { referralRewardCredits?: number }).referralRewardCredits ?? 0)
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

    waiversClient.getAdmin(studioId, token).then(res => {
      if (res.waiver) {
        setExistingWaiver(res.waiver)
        setWaiverTitle(res.waiver.title)
        setWaiverBody(res.waiver.body)
        setWaiverEnabled(true)
      }
    }).catch(() => {}).finally(() => setWaiverLoading(false))

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/studios/${studioId}/ai`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then((d: { aiEnabled: boolean; hasKey: boolean; keySuffix: string | null }) => {
      setAiEnabled(d.aiEnabled)
      setAiHasKey(d.hasKey)
      setAiKeySuffix(d.keySuffix)
    }).catch(() => {})
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
      type StudioExtended = typeof studio & { websiteUrl?: string; supportEmail?: string; bookingWindowDays?: number; bookingCloseHours?: number; waitlistEnabled?: boolean; guestCheckInEnabled?: boolean; creditPurchaseEnabled?: boolean; selfCheckInEnabled?: boolean; classReminderHours?: number | null; maxPauseDays?: number; maxPausesPerYear?: number; allowMemberPause?: boolean; taxRatePct?: number; referralRewardCredits?: number }
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
        allowMemberPause: allowMemberPause !== (s.allowMemberPause ?? true) ? allowMemberPause : undefined,
        taxRatePct: taxRatePct !== (s.taxRatePct ?? 0) ? taxRatePct : undefined,
        referralRewardCredits: referralRewardCredits !== (s.referralRewardCredits ?? 0) ? referralRewardCredits : undefined,
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

  async function handleSaveWaiver() {
    setWaiverSaving(true)
    try {
      if (!waiverEnabled) {
        await waiversClient.remove(studioId, token)
        setExistingWaiver(null)
        setWaiverTitle('')
        setWaiverBody('')
        showToast('Waiver removed')
      } else {
        if (!waiverTitle.trim() || !waiverBody.trim()) { showToast('Title and body are required', false); return }
        await waiversClient.upsert(studioId, waiverTitle, waiverBody, token)
        // Reload to get updated version
        const res = await waiversClient.getAdmin(studioId, token)
        if (res.waiver) setExistingWaiver(res.waiver)
        showToast('Waiver saved')
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save waiver', false)
    } finally {
      setWaiverSaving(false)
    }
  }

  const isPolicyDirty =
    lateCancelWindowHours  !== savedPolicy.lateCancelWindowHours  ||
    lateCancelFeeCredits   !== savedPolicy.lateCancelFeeCredits   ||
    noShowFeeCredits        !== savedPolicy.noShowFeeCredits       ||
    waitlistWindowMinutes  !== savedPolicy.waitlistWindowMinutes

  type StudioExt = typeof studio & { websiteUrl?: string; supportEmail?: string; bookingWindowDays?: number; bookingCloseHours?: number; waitlistEnabled?: boolean; guestCheckInEnabled?: boolean; creditPurchaseEnabled?: boolean; selfCheckInEnabled?: boolean; classReminderHours?: number | null; maxPauseDays?: number; maxPausesPerYear?: number; allowMemberPause?: boolean; taxRatePct?: number; referralRewardCredits?: number }
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
    allowMemberPause !== (s2?.allowMemberPause ?? true) ||
    taxRatePct !== (s2?.taxRatePct ?? 0) ||
    referralRewardCredits !== (s2?.referralRewardCredits ?? 0) ||
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

  const TAB_LABELS: { id: SettingsPanel; label: string }[] = [
    { id: 'general',  label: 'General'  },
    { id: 'policies', label: 'Policies' },
    { id: 'features', label: 'Features' },
    { id: 'ai',       label: 'AI'       },
  ]

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Tab strip */}
      <div className="flex gap-1 border-b border-gray-100">
        {TAB_LABELS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setPanel(id)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              panel === id
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── GENERAL ────────────────────────────────────────────────────── */}
      {panel === 'general' && <div className="space-y-6">

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
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">Website URL</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={websiteUrl}
                onChange={e => setWebsiteUrl(e.target.value)}
                placeholder="https://mystudio.com"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500 font-medium">Support email</label>
              <input
                type="email"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={supportEmail}
                onChange={e => setSupportEmail(e.target.value)}
                placeholder="hello@mystudio.com"
              />
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

        {/* General save */}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {isDirty && (
            <button onClick={() => { if (!studio) return; setName(studio.name); setSlug(studio.slug); setTimezone(studio.timezone); setCurrency(studio.currency); setTimeFormat((studio.timeFormat ?? '24h') as '12h' | '24h'); setWebsiteUrl((studio as StudioExt).websiteUrl ?? ''); setSupportEmail((studio as StudioExt).supportEmail ?? ''); const loc = studio.locations[0]; if (loc) { setLocName(loc.name); setAddress(loc.address); setCity(loc.city); setCountry(loc.country) } }}
              className="text-sm text-gray-400 hover:text-gray-700 transition-colors">Discard</button>
          )}
        </div>
      </div>}{/* end General panel */}

      {/* ── POLICIES ───────────────────────────────────────────────────── */}
      {panel === 'policies' && <div className="space-y-6">

        {/* Booking */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Booking</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 font-medium">Booking window (days)</label>
              <p className="text-[10px] text-gray-400 mb-1">How far in advance members can book</p>
              <input type="number" min="1" max="365"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={bookingWindowDays} onChange={e => setBookingWindowDays(parseInt(e.target.value) || 30)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">Booking close (hours before)</label>
              <p className="text-[10px] text-gray-400 mb-1">Locks N hours before class starts</p>
              <input type="number" min="0" max="72"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={bookingCloseHours} onChange={e => setBookingCloseHours(parseInt(e.target.value) || 0)} />
            </div>
          </div>
        </section>

        {/* Cancellation */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cancellation</h3>
          {policyLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-gray-50 rounded-xl animate-pulse" />)}</div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium">Late cancel window</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="number" min={0} value={lateCancelWindowHours}
                    onChange={e => setLateCancelWindowHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-24 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums" />
                  <span className="text-sm text-gray-500">hours before class</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-1">Cancellations within this window are treated as late cancels.</p>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Late cancel fee</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" min={0} value={lateCancelFeeCredits}
                      onChange={e => setLateCancelFeeCredits(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums" />
                    <span className="text-sm text-gray-500">cr</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">0 = no fee</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">No-show fee</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" min={0} value={noShowFeeCredits}
                      onChange={e => setNoShowFeeCredits(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums" />
                    <span className="text-sm text-gray-500">cr</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">Charged post-session without check-in</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Waitlist confirm window</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" min={1} value={waitlistWindowMinutes}
                      onChange={e => setWaitlistWindowMinutes(Math.max(1, parseInt(e.target.value) || 1))}
                      className="w-20 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 tabular-nums" />
                    <span className="text-sm text-gray-500">min</span>
                  </div>
                  <p className="text-[10px] text-gray-400 mt-1">To confirm a waitlist spot</p>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button onClick={handleSavePolicy} disabled={policySaving || !isPolicyDirty}
                  className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
                  {policySaving ? 'Saving…' : 'Save cancellation policy'}
                </button>
                {isPolicyDirty && (
                  <button onClick={() => { setLateCancelWindowHours(savedPolicy.lateCancelWindowHours); setLateCancelFeeCredits(savedPolicy.lateCancelFeeCredits); setNoShowFeeCredits(savedPolicy.noShowFeeCredits); setWaitlistWindowMinutes(savedPolicy.waitlistWindowMinutes) }}
                    className="text-sm text-gray-400 hover:text-gray-700 transition-colors">Discard</button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Membership pause */}
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Membership pause</h3>
          <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
            <input type="checkbox" checked={allowMemberPause} onChange={e => setAllowMemberPause(e.target.checked)} className="mt-0.5 rounded" />
            <span>
              <span className="text-sm font-medium text-gray-900 block">Allow members to self-pause</span>
              <span className="text-xs text-gray-400">Members can pause their own subscription from their account page</span>
            </span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 font-medium">Max pause duration (days)</label>
              <input type="number" min="1" max="365"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={maxPauseDays} onChange={e => setMaxPauseDays(parseInt(e.target.value) || 30)} />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium">Max pauses per year</label>
              <input type="number" min="1" max="12"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={maxPausesPerYear} onChange={e => setMaxPausesPerYear(parseInt(e.target.value) || 2)} />
            </div>
          </div>
        </section>

        {/* Tax / VAT */}
        <section className="space-y-3 pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tax / VAT</h3>
          <div className="flex items-end gap-3">
            <div className="w-36">
              <label className="text-xs text-gray-500 font-medium">Tax rate (%)</label>
              <input type="number" min="0" max="100" step="0.1"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={taxRatePct} onChange={e => setTaxRatePct(parseFloat(e.target.value) || 0)} />
            </div>
            <p className="text-xs text-gray-400 pb-2">Set to 0 to disable tax. Applied to Stripe checkout and shown on receipts.</p>
          </div>
        </section>

        {/* Referral programme */}
        <section className="space-y-3 pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Referral programme</h3>
          <div className="flex items-end gap-3">
            <div className="w-36">
              <label className="text-xs text-gray-500 font-medium">Credits per referral</label>
              <input type="number" min="0" step="1"
                className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={referralRewardCredits} onChange={e => setReferralRewardCredits(parseInt(e.target.value) || 0)} />
            </div>
            <p className="text-xs text-gray-400 pb-2">Credits awarded to a member when someone they referred takes their first class. Set to 0 to disable.</p>
          </div>
        </section>

        {/* Liability waiver */}
        <section className="space-y-3 pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Liability waiver</h3>
          <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-2 rounded-xl hover:bg-gray-50 transition-colors">
            <input type="checkbox" checked={waiverEnabled} onChange={e => setWaiverEnabled(e.target.checked)} className="mt-0.5 rounded" />
            <span>
              <span className="text-sm font-medium text-gray-900 block">Require waiver before first booking</span>
              <span className="text-xs text-gray-400">Members must read and accept a liability waiver before booking a class</span>
            </span>
          </label>
          {waiverEnabled && (
            <div className="space-y-3 pl-7">
              {existingWaiver && (
                <p className="text-xs text-gray-400">Version {existingWaiver.version} — saving creates a new version and requires all members to re-sign</p>
              )}
              <div>
                <label className="text-xs text-gray-500 font-medium">Waiver title</label>
                <input
                  type="text"
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                  placeholder="e.g. Liability Waiver & Release of Claims"
                  value={waiverTitle}
                  onChange={e => setWaiverTitle(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 font-medium">Waiver text</label>
                <textarea
                  rows={10}
                  className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-gray-400 resize-y"
                  placeholder="By signing this waiver, I acknowledge…"
                  value={waiverBody}
                  onChange={e => setWaiverBody(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 pl-7">
            <button
              onClick={handleSaveWaiver}
              disabled={waiverSaving || waiverLoading}
              className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {waiverSaving ? 'Saving…' : waiverEnabled ? 'Save waiver' : 'Remove waiver'}
            </button>
            {waiverEnabled && existingWaiver && (
              <span className="text-xs text-gray-400">Currently active: v{existingWaiver.version}</span>
            )}
          </div>
        </section>

        {/* Policies save */}
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {isDirty && (
            <button onClick={() => { if (!studio) return; setBookingWindowDays((studio as StudioExt).bookingWindowDays ?? 30); setBookingCloseHours((studio as StudioExt).bookingCloseHours ?? 1); setMaxPauseDays((studio as StudioExt).maxPauseDays ?? 30); setMaxPausesPerYear((studio as StudioExt).maxPausesPerYear ?? 2) }}
              className="text-sm text-gray-400 hover:text-gray-700 transition-colors">Discard</button>
          )}
        </div>

      </div>}{/* end Policies panel */}

      {/* ── FEATURES ───────────────────────────────────────────────────── */}
      {panel === 'features' && <div className="space-y-6">

        <section className="space-y-1">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Features</h3>
          {([
            { label: 'Waitlist', description: 'Members can join the waitlist when a class is full', value: waitlistEnabled, set: setWaitlistEnabled },
            { label: 'Guest check-in', description: 'Staff can use guest passes to check in guests', value: guestCheckInEnabled, set: setGuestCheckInEnabled },
            { label: 'Online credit purchase', description: 'Members can buy plans and credits via Stripe on their account page', value: creditPurchaseEnabled, set: setCreditPurchaseEnabled },
            { label: 'Member self check-in', description: 'Members can check themselves in within 30 min of class start', value: selfCheckInEnabled, set: setSelfCheckInEnabled },
          ] as const).map(({ label, description, value, set }) => (
            <label key={label} className="flex items-start gap-3 cursor-pointer select-none px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors">
              <input type="checkbox" checked={value} onChange={e => (set as (v: boolean) => void)(e.target.checked)} className="mt-0.5 rounded" />
              <span>
                <span className="text-sm font-medium text-gray-900 block">{label}</span>
                <span className="text-xs text-gray-400">{description}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="space-y-3 pt-4 border-t border-gray-100">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Class reminder email</h3>
          <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors">
            <input type="checkbox" checked={classReminderEnabled} onChange={e => setClassReminderEnabled(e.target.checked)} className="mt-0.5 rounded" />
            <span>
              <span className="text-sm font-medium text-gray-900 block">Send class reminders</span>
              <span className="text-xs text-gray-400">Email members before their upcoming class</span>
            </span>
          </label>
          {classReminderEnabled && (
            <div className="flex items-center gap-2 pl-3">
              <input type="number" min="1" max="168"
                className="w-20 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                value={classReminderHours} onChange={e => setClassReminderHours(parseInt(e.target.value) || 24)} />
              <span className="text-sm text-gray-500">hours before class</span>
            </div>
          )}
        </section>

        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <button onClick={handleSave} disabled={saving || !isDirty}
            className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {isDirty && (
            <button onClick={() => { if (!studio) return; const s = studio as StudioExt; setWaitlistEnabled(s.waitlistEnabled ?? true); setGuestCheckInEnabled(s.guestCheckInEnabled ?? true); setCreditPurchaseEnabled(s.creditPurchaseEnabled ?? true); setSelfCheckInEnabled(s.selfCheckInEnabled ?? false); setClassReminderEnabled(s.classReminderHours !== null); setClassReminderHours(s.classReminderHours ?? 24) }}
              className="text-sm text-gray-400 hover:text-gray-700 transition-colors">Discard</button>
          )}
        </div>

      </div>}{/* end Features panel */}

      {/* ── AI ──────────────────────────────────────────────────────────── */}
      {panel === 'ai' && (
        <div className="space-y-6">
          <section className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">AI Assistant</h3>
            <p className="text-sm text-gray-500">
              The AI assistant helps members book classes, check credits, and get answers — and gives your front desk staff a natural language interface to manage check-ins and spot assignments.
            </p>

            <label className="flex items-start gap-3 cursor-pointer select-none px-3 py-3 rounded-xl hover:bg-gray-50 transition-colors">
              <input type="checkbox" checked={aiEnabled} onChange={e => setAiEnabled(e.target.checked)} className="mt-0.5 rounded" />
              <span>
                <span className="text-sm font-medium text-gray-900 block">Enable AI assistant</span>
                <span className="text-xs text-gray-400">Shows the chat bubble to all users on your studio</span>
              </span>
            </label>
          </section>

          <section className="space-y-3 pt-4 border-t border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Anthropic API Key</h3>
            <p className="text-sm text-gray-500">
              Provide your own Anthropic API key to use your own billing and rate limits. If left blank, the platform key is used.
            </p>

            {aiHasKey && !aiShowKeyInput ? (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-xl text-sm">
                  <svg className="w-3.5 h-3.5 text-emerald-600" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="text-emerald-700 font-medium">Key set</span>
                  {aiKeySuffix && <span className="text-emerald-500 font-mono text-xs">{aiKeySuffix}</span>}
                </div>
                <button onClick={() => setAiShowKeyInput(true)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Change</button>
                <button
                  onClick={async () => {
                    setAiSaving(true)
                    try {
                      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/studios/${studioId}/ai`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ anthropicApiKey: null }),
                      })
                      const d = await r.json()
                      setAiHasKey(d.hasKey); setAiKeySuffix(d.keySuffix)
                      showToast('API key removed')
                    } catch { showToast('Failed to remove key', false) }
                    finally { setAiSaving(false) }
                  }}
                  className="text-sm text-red-400 hover:text-red-600 transition-colors"
                >Remove</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={aiKeyInput}
                  onChange={e => setAiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/10"
                />
                <button
                  disabled={!aiKeyInput.trim() || aiSaving}
                  onClick={async () => {
                    setAiSaving(true)
                    try {
                      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/studios/${studioId}/ai`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ anthropicApiKey: aiKeyInput.trim() }),
                      })
                      const d = await r.json()
                      setAiHasKey(d.hasKey); setAiKeySuffix(d.keySuffix)
                      setAiKeyInput(''); setAiShowKeyInput(false)
                      showToast('API key saved')
                    } catch { showToast('Failed to save key', false) }
                    finally { setAiSaving(false) }
                  }}
                  className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-xl hover:bg-gray-700 disabled:opacity-40 transition-colors"
                >{aiSaving ? 'Saving…' : 'Save key'}</button>
                {aiShowKeyInput && (
                  <button onClick={() => setAiShowKeyInput(false)} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">Cancel</button>
                )}
              </div>
            )}
          </section>

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <button
              disabled={aiSaving}
              onClick={async () => {
                setAiSaving(true)
                try {
                  await fetch(`${process.env.NEXT_PUBLIC_API_URL}/studios/${studioId}/ai`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ aiEnabled }),
                  })
                  showToast('AI settings saved')
                } catch { showToast('Failed to save', false) }
                finally { setAiSaving(false) }
              }}
              className="text-sm font-medium bg-gray-900 text-white px-5 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >{aiSaving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}{/* end AI panel */}

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
