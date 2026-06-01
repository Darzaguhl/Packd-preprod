'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api-client'
import { members as membersClient } from '@/lib/api-client'

interface Props {
  token: string
  activeSubscriptionId?: string | null
  allowMemberPause?: boolean
  referralEnabled?: boolean  // referralRewardCredits > 0
}

// ── Referral widget ───────────────────────────────────────────────────────────
function ReferralSection({ token }: { token: string }) {
  const [data, setData] = useState<{ code: string; totalReferrals: number; creditsEarned: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [applyCode, setApplyCode] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState<{ text: string; ok: boolean } | null>(null)

  useEffect(() => {
    membersClient.referral(token).then(setData).catch(() => {})
  }, [token])

  function copy() {
    if (!data) return
    navigator.clipboard.writeText(data.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleApply(e: React.FormEvent) {
    e.preventDefault()
    if (!applyCode.trim()) return
    setApplying(true)
    setApplyMsg(null)
    try {
      await membersClient.applyReferral(applyCode.trim().toUpperCase(), token)
      setApplyMsg({ text: 'Referral code applied! Your referrer will earn credits when you take your first class.', ok: true })
      setApplyCode('')
    } catch (err) {
      setApplyMsg({ text: err instanceof Error ? err.message : 'Invalid code', ok: false })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Share your code */}
      {data && (
        <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-800">Share your referral code</p>
          <p className="text-xs text-gray-500">When a friend signs up and takes their first class, you both benefit.</p>
          <div className="flex items-center gap-2">
            <span className="flex-1 font-mono text-lg font-bold text-gray-900 tracking-widest">{data.code}</span>
            <button
              onClick={copy}
              className="text-xs font-medium px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          {data.totalReferrals > 0 && (
            <p className="text-xs text-gray-400">
              {data.totalReferrals} referral{data.totalReferrals !== 1 ? 's' : ''} · {data.creditsEarned} credits earned
            </p>
          )}
        </div>
      )}

      {/* Apply a code */}
      <form onSubmit={handleApply} className="space-y-2">
        <p className="text-sm font-medium text-gray-700">Have a friend's code?</p>
        <div className="flex gap-2">
          <input
            value={applyCode}
            onChange={e => setApplyCode(e.target.value.toUpperCase())}
            placeholder="ENTER CODE"
            maxLength={10}
            className="flex-1 font-mono text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900 uppercase"
          />
          <button
            type="submit"
            disabled={applying || !applyCode.trim()}
            className="text-sm font-medium px-4 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-40 hover:bg-gray-700 transition-colors"
          >
            {applying ? '…' : 'Apply'}
          </button>
        </div>
        {applyMsg && (
          <p className={`text-xs ${applyMsg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{applyMsg.text}</p>
        )}
      </form>
    </div>
  )
}

// ── Email preferences ─────────────────────────────────────────────────────────
function EmailPrefsSection({ token }: { token: string }) {
  const [prefs, setPrefs] = useState({ classReminder: true, marketing: true, waitlist: true })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function toggle(key: keyof typeof prefs) {
    const next = { ...prefs, [key]: !prefs[key] }
    setPrefs(next)
    setSaving(true)
    try {
      await membersClient.updateEmailPreferences(next, token)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const items = [
    { key: 'classReminder' as const, label: 'Class reminders', description: 'Reminder emails before your booked classes' },
    { key: 'waitlist' as const, label: 'Waitlist notifications', description: 'Emails when you move off a waitlist' },
    { key: 'marketing' as const, label: 'Studio news & offers', description: 'Announcements and promotional messages' },
  ]

  return (
    <div className="space-y-3">
      {items.map(item => (
        <label key={item.key} className="flex items-start gap-3 cursor-pointer">
          <div className="mt-0.5">
            <button
              role="switch"
              aria-checked={prefs[item.key]}
              onClick={() => toggle(item.key)}
              disabled={saving}
              className={`w-9 h-5 rounded-full transition-colors shrink-0 relative ${prefs[item.key] ? 'bg-gray-900' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${prefs[item.key] ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">{item.label}</p>
            <p className="text-xs text-gray-400">{item.description}</p>
          </div>
        </label>
      ))}
      {saved && <p className="text-xs text-emerald-600">Preferences saved</p>}
    </div>
  )
}

// ── Self-pause ────────────────────────────────────────────────────────────────
function SelfPauseSection({ token, subscriptionId }: { token: string; subscriptionId: string }) {
  const [pauseUntil, setPauseUntil] = useState('')
  const [pausing, setPausing] = useState(false)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  const minDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  async function handlePause(e: React.FormEvent) {
    e.preventDefault()
    if (!pauseUntil) return
    setPausing(true)
    setMsg(null)
    try {
      await api.members.selfPause(subscriptionId, pauseUntil, token)
      setMsg({ text: `Membership paused until ${new Date(pauseUntil).toLocaleDateString()}. You can resume anytime from this page.`, ok: true })
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Failed to pause', ok: false })
    } finally {
      setPausing(false)
    }
  }

  return (
    <form onSubmit={handlePause} className="space-y-3">
      <p className="text-sm text-gray-500">Pause your membership for a holiday or break. Your subscription won't renew while paused.</p>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Pause until</label>
          <input
            type="date"
            value={pauseUntil}
            onChange={e => setPauseUntil(e.target.value)}
            min={minDate}
            max={maxDate}
            required
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
        </div>
        <button
          type="submit"
          disabled={pausing || !pauseUntil}
          className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-40 transition-colors"
        >
          {pausing ? '…' : 'Pause membership'}
        </button>
      </div>
      {msg && <p className={`text-xs ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}>{msg.text}</p>}
    </form>
  )
}

// ── Receipts ──────────────────────────────────────────────────────────────────
function ReceiptsSection({ token }: { token: string }) {
  const [receipts, setReceipts] = useState<{ id: string; soldAt: string; totalCents: number; currency: string; stripeReceiptUrl: string | null; items: unknown[] }[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.members.receipts(token).then(setReceipts).catch(() => {}).finally(() => setLoading(false))
  }, [token])

  if (loading) return <div className="h-10 bg-gray-100 rounded-xl animate-pulse" />
  if (!receipts.length) return <p className="text-sm text-gray-400">No purchases yet.</p>

  return (
    <div className="space-y-2">
      {receipts.map(r => (
        <div key={r.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
          <div>
            <p className="text-sm text-gray-800">
              {new Intl.NumberFormat('en', { style: 'currency', currency: r.currency }).format(r.totalCents / 100)}
            </p>
            <p className="text-xs text-gray-400">{new Date(r.soldAt).toLocaleDateString()}</p>
          </div>
          {r.stripeReceiptUrl ? (
            <a href={r.stripeReceiptUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs font-medium text-gray-600 hover:text-gray-900 underline">
              Receipt
            </a>
          ) : (
            <span className="text-xs text-gray-300">No receipt</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── GDPR section ──────────────────────────────────────────────────────────────
function GdprSection({ token }: { token: string }) {
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  async function handleExport() {
    setExporting(true)
    try {
      const res = await api.members.exportData(token)
      const blob = await res.blob()
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = 'my-packd-data.json'
      a.click()
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    if (deleteConfirm !== 'DELETE') return
    setDeleting(true)
    try {
      await membersClient.deleteAccount(token)
      window.location.href = '/login'
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete account')
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-800">Download your data</p>
          <p className="text-xs text-gray-400">A JSON file with all your bookings, transactions, and profile data.</p>
        </div>
        <button onClick={handleExport} disabled={exporting}
          className="text-xs font-medium px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors">
          {exporting ? 'Preparing…' : 'Export'}
        </button>
      </div>

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <p className="text-sm font-medium text-red-600">Delete account</p>
        <p className="text-xs text-gray-400">This permanently removes your account and all data. Cancels any active subscriptions. This cannot be undone.</p>
        <form onSubmit={handleDelete} className="flex gap-2">
          <input
            value={deleteConfirm}
            onChange={e => setDeleteConfirm(e.target.value)}
            placeholder='Type "DELETE" to confirm'
            className="flex-1 text-sm px-3 py-2 border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
          />
          <button
            type="submit"
            disabled={deleteConfirm !== 'DELETE' || deleting}
            className="text-xs font-medium px-4 py-2 bg-red-600 text-white rounded-lg disabled:opacity-40 hover:bg-red-700 transition-colors"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AccountExtrasSection({ token, activeSubscriptionId, allowMemberPause = true, referralEnabled = false }: Props) {
  type Section = 'referral' | 'email' | 'pause' | 'receipts' | 'privacy'
  const [open, setOpen] = useState<Section | null>(null)

  const sections = ([
    { id: 'referral' as Section, label: 'Refer a friend', show: referralEnabled },
    { id: 'email' as Section, label: 'Email preferences', show: true },
    { id: 'pause' as Section, label: 'Pause membership', show: allowMemberPause && !!activeSubscriptionId },
    { id: 'receipts' as Section, label: 'Purchase receipts', show: true },
    { id: 'privacy' as Section, label: 'Privacy & data', show: true },
  ] as { id: Section; label: string; show: boolean }[]).filter(s => s.show)

  return (
    <div className="space-y-1">
      {sections.map(s => (
        <div key={s.id} className="border border-gray-100 rounded-2xl overflow-hidden">
          <button
            onClick={() => setOpen(open === s.id ? null : s.id)}
            className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
          >
            <span className="text-sm font-medium text-gray-800">{s.label}</span>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${open === s.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {open === s.id && (
            <div className="px-5 pb-5 border-t border-gray-50">
              {s.id === 'referral' && <div className="pt-4"><ReferralSection token={token} /></div>}
              {s.id === 'email' && <div className="pt-4"><EmailPrefsSection token={token} /></div>}
              {s.id === 'pause' && activeSubscriptionId && <div className="pt-4"><SelfPauseSection token={token} subscriptionId={activeSubscriptionId} /></div>}
              {s.id === 'receipts' && <div className="pt-4"><ReceiptsSection token={token} /></div>}
              {s.id === 'privacy' && <div className="pt-4"><GdprSection token={token} /></div>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
