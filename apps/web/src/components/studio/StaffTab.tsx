'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, type StaffMember } from '@/lib/api'

interface Props {
  studioId: string
  token: string
}

const STAFF_ROLE_LABELS: Record<string, string> = {
  fronthost: 'Front Desk',
}

export default function StaffTab({ studioId, token }: Props) {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [addEmail, setAddEmail] = useState('')
  const [addRole, setAddRole] = useState('fronthost')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setStaff(await api.staff.list(studioId, token))
    } finally {
      setLoading(false)
    }
  }, [studioId, token])

  useEffect(() => { load() }, [load])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim()) return
    setAdding(true)
    setError(null)
    setSuccess(null)
    try {
      await api.staff.assign(studioId, addEmail.trim(), addRole, token)
      setSuccess(`${addEmail.trim()} assigned as ${STAFF_ROLE_LABELS[addRole] ?? addRole}.`)
      setAddEmail('')
      await load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(member: StaffMember) {
    if (!confirm(`Remove ${member.name} (${member.email}) from staff? Their account will revert to a regular member.`)) return
    setError(null)
    setSuccess(null)
    try {
      await api.staff.remove(member.id, studioId, token)
      setSuccess(`${member.name} removed from staff.`)
      await load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="space-y-6">
      {/* Add staff */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-1">Add staff member</h3>
        <p className="text-xs text-gray-400 mb-4">
          The user must already have a Packd account. They'll receive the selected role immediately — no invite needed.
        </p>
        <form onSubmit={handleAdd} className="flex gap-3 flex-wrap">
          <input
            type="email"
            placeholder="user@example.com"
            value={addEmail}
            onChange={e => setAddEmail(e.target.value)}
            required
            className="flex-1 min-w-48 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <select
            value={addRole}
            onChange={e => setAddRole(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="fronthost">Front Desk</option>
          </select>
          <button
            type="submit"
            disabled={adding || !addEmail.trim()}
            className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-40 transition-colors"
          >
            {adding ? 'Assigning…' : 'Assign role'}
          </button>
        </form>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        {success && <p className="mt-3 text-xs text-emerald-600">{success}</p>}
      </div>

      {/* Staff list */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          Current staff · {staff.length} {staff.length === 1 ? 'person' : 'people'}
        </h3>

        {loading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 bg-white rounded-2xl border border-gray-100 animate-pulse" />
            ))}
          </div>
        ) : staff.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-10 text-center text-sm text-gray-400">
            No staff members yet. Add someone above.
          </div>
        ) : (
          <div className="space-y-2">
            {staff.map(member => (
              <div
                key={member.id}
                className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-4"
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-gray-600">
                    {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{member.name}</p>
                  <p className="text-xs text-gray-400 truncate">{member.email}</p>
                </div>

                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 shrink-0">
                  {STAFF_ROLE_LABELS[member.staffRole] ?? member.staffRole}
                </span>

                <button
                  onClick={() => handleRemove(member)}
                  className="text-xs text-gray-400 hover:text-red-500 transition-colors shrink-0 ml-1"
                  title="Remove staff role"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
