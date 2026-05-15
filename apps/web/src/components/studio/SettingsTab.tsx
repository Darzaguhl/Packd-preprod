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
  onStudioUpdate?: (data: { name: string; timezone: string; currency: string }) => void
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

  // Location fields (first location)
  const [locName, setLocName] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')

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
      const loc = s.locations[0]
      if (loc) {
        setLocName(loc.name)
        setAddress(loc.address)
        setCity(loc.city)
        setCountry(loc.country)
      }
    }).finally(() => setLoading(false))
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
      const res = await api.studios.update(studioId, {
        name: name !== studio.name ? name : undefined,
        slug: slug !== studio.slug ? slug : undefined,
        timezone: timezone !== studio.timezone ? timezone : undefined,
        currency: currency !== studio.currency ? currency : undefined,
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
      onStudioUpdate?.({ name: res.studio.name, timezone: res.studio.timezone, currency: res.studio.currency })
      showToast('Settings saved')
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : 'Failed to save', false)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = studio && (
    name !== studio.name ||
    slug !== studio.slug ||
    timezone !== studio.timezone ||
    currency !== studio.currency ||
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
              const loc = studio.locations[0]
              if (loc) { setLocName(loc.name); setAddress(loc.address); setCity(loc.city); setCountry(loc.country) }
            }}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            Discard
          </button>
        )}
      </div>

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
