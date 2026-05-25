'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import ApprovedPhotosGallery from './ApprovedPhotosGallery'
import PhotosTab from './PhotosTab'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function avatarColor(id: string) {
  const COLORS = [
    'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500',
  ]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

// ─── Instructor type ─────────────────────────────────────────────────────────

interface Instructor {
  id: string   // Instructor record id
  name: string
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  studioId: string
  token: string
}

type Section = 'approved' | 'repos'

export default function SocialPhotosTab({ studioId, token }: Props) {
  const [section, setSection]         = useState<Section>('approved')
  const [instructors, setInstructors] = useState<Instructor[]>([])
  const [loadingInst, setLoadingInst] = useState(true)
  const [selectedInst, setSelectedInst] = useState<Instructor | null>(null)

  useEffect(() => {
    api.franchise.staffPermissions(studioId, token)
      .then(staff => {
        const insts = staff
          .filter(s => s.roles.includes('instructor') && s.id)
          .map(s => ({ id: s.id, name: s.name }))
        setInstructors(insts)
        if (insts.length > 0) setSelectedInst(insts[0])
      })
      .catch(() => {})
      .finally(() => setLoadingInst(false))
  }, [studioId, token])

  return (
    <div className="space-y-6">
      {/* Section switcher */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setSection('approved')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            section === 'approved' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          ✓ Approved
        </button>
        <button
          onClick={() => setSection('repos')}
          className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
            section === 'repos' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Photo Repositories
        </button>
      </div>

      {/* Approved gallery (with instructor filter pills + unapprove) */}
      {section === 'approved' && (
        <ApprovedPhotosGallery studioId={studioId} token={token} />
      )}

      {/* Per-instructor photo repositories */}
      {section === 'repos' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Browse each instructor&apos;s full photo library and approve photos for social media.
          </p>

          {loadingInst ? (
            <div className="flex gap-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-10 w-28 bg-gray-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : instructors.length === 0 ? (
            <p className="text-sm text-gray-400">No instructors found for this studio.</p>
          ) : (
            <>
              {/* Instructor selector */}
              <div className="flex flex-wrap gap-2">
                {instructors.map(inst => {
                  const isActive = selectedInst?.id === inst.id
                  return (
                    <button
                      key={inst.id}
                      onClick={() => setSelectedInst(inst)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                        isActive
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full ${avatarColor(inst.id)} flex items-center justify-center text-white text-[9px] font-semibold shrink-0`}>
                        {initials(inst.name)}
                      </div>
                      {inst.name}
                    </button>
                  )
                })}
              </div>

              {/* Selected instructor's photos */}
              {selectedInst && (
                <div className="bg-white border border-gray-100 rounded-2xl p-5">
                  <div className="flex items-center gap-2.5 mb-5">
                    <div className={`w-8 h-8 rounded-full ${avatarColor(selectedInst.id)} flex items-center justify-center text-white text-sm font-semibold`}>
                      {initials(selectedInst.name)}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{selectedInst.name}</p>
                      <p className="text-xs text-gray-400">Photo repository</p>
                    </div>
                  </div>
                  {/* isManager=true hides the delete button (instructors delete their own) */}
                  <PhotosTab instructorId={selectedInst.id} token={token} isManager={true} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
