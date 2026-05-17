'use client'

import { useState, useEffect } from 'react'
import { api, type InstructorWithPermissions, type InstructorPermissions, DEFAULT_INSTRUCTOR_PERMISSIONS } from '@/lib/api'

const PERMISSION_META: { key: keyof InstructorPermissions; label: string; description: string }[] = [
  { key: 'canCheckInMembers',     label: 'Check in members',      description: 'Scan or manually check in attendees at class' },
  { key: 'canManageWaitlist',     label: 'Manage waitlist',       description: 'Promote or remove members from the waitlist' },
  { key: 'canManageBookings',     label: 'Manage bookings',       description: 'Cancel or modify member bookings' },
  { key: 'canViewMemberContact',  label: 'View member contact',   description: 'See member email addresses and phone numbers' },
  { key: 'canEditSessionDetails', label: 'Edit session details',  description: 'Change capacity, credits required, or timing' },
  { key: 'canCancelSession',      label: 'Cancel a session',      description: 'Mark a session as cancelled' },
  { key: 'canCreateSchedules',    label: 'Create & edit schedules', description: 'Add recurring schedules and modify existing ones' },
]

interface Props {
  studioId: string
  token: string
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

export default function PermissionsTab({ studioId, token }: Props) {
  const [instructors, setInstructors] = useState<InstructorWithPermissions[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [local, setLocal] = useState<Record<string, InstructorPermissions>>({})

  useEffect(() => {
    api.franchise.instructors(studioId, token)
      .then(data => {
        setInstructors(data)
        const map: Record<string, InstructorPermissions> = {}
        for (const inst of data) {
          map[inst.id] = { ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...inst.permissions }
        }
        setLocal(map)
        if (data.length > 0) setExpanded(data[0].id)
      })
      .finally(() => setLoading(false))
  }, [studioId, token])

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function toggle(instructorId: string, key: keyof InstructorPermissions) {
    setLocal(prev => ({
      ...prev,
      [instructorId]: { ...prev[instructorId], [key]: !prev[instructorId][key] },
    }))
  }

  async function save(instructorId: string) {
    setSaving(instructorId)
    try {
      const res = await api.franchise.updatePermissions(studioId, instructorId, local[instructorId], token)
      setInstructors(prev => prev.map(i => i.id === instructorId ? { ...i, permissions: res.permissions } : i))
      showToast('Permissions saved')
    } catch {
      showToast('Failed to save', false)
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-2 py-4">
        {[...Array(2)].map((_, i) => <div key={i} className="h-20 bg-gray-50 rounded-2xl animate-pulse" />)}
      </div>
    )
  }

  if (instructors.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">No instructors assigned to this studio yet.</p>
  }

  return (
    <div className="space-y-2">
      {instructors.map(inst => {
        const perms = local[inst.id] ?? DEFAULT_INSTRUCTOR_PERMISSIONS
        const isOpen = expanded === inst.id
        const isDirty = JSON.stringify(perms) !== JSON.stringify({ ...DEFAULT_INSTRUCTOR_PERMISSIONS, ...inst.permissions })

        return (
          <div key={inst.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            {/* Header */}
            <button
              className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : inst.id)}
            >
              <div className="w-9 h-9 rounded-full bg-gray-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                {initials(inst.name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{inst.name}</p>
                <p className="text-xs text-gray-400">{inst.email}</p>
              </div>
              {isDirty && (
                <span className="text-[10px] font-semibold text-amber-500 bg-amber-50 rounded-full px-2 py-0.5">Unsaved</span>
              )}
              <svg className={`w-4 h-4 text-gray-300 transition-transform ${isOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 16 16">
                <path d="M6 4l4 4-4 4" strokeLinecap="round" />
              </svg>
            </button>

            {/* Permissions grid */}
            {isOpen && (
              <div className="border-t border-gray-50 px-5 py-4 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {PERMISSION_META.map(({ key, label, description }) => (
                    <label key={key} className="flex items-center gap-3 cursor-pointer">
                      <button
                        role="switch"
                        aria-checked={perms[key]}
                        onClick={() => toggle(inst.id, key)}
                        className={`w-10 h-6 rounded-full transition-colors shrink-0 relative ${
                          perms[key] ? 'bg-gray-900' : 'bg-gray-300'
                        }`}
                      >
                        <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                          perms[key] ? 'translate-x-4' : 'translate-x-0'
                        }`} />
                      </button>
                      <div>
                        <p className="text-sm font-medium text-gray-800 leading-tight">{label}</p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-snug">{description}</p>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => save(inst.id)}
                    disabled={saving === inst.id}
                    className="text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
                  >
                    {saving === inst.id ? 'Saving…' : 'Save permissions'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

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
