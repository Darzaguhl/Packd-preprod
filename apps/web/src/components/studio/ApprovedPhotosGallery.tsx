'use client'

import { useState, useEffect } from 'react'
import { api, type InstructorPhoto } from '@/lib/api-client'

type ApprovedPhoto = InstructorPhoto & { instructorName: string }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

// Deterministic hue from instructor id
function avatarColor(id: string) {
  const COLORS = [
    'bg-violet-500', 'bg-sky-500', 'bg-emerald-500',
    'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-teal-500',
  ]
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

function InstructorAvatar({ id, name, size = 'sm' }: { id: string; name: string; size?: 'sm' | 'xs' }) {
  const sz = size === 'xs' ? 'w-5 h-5 text-[9px]' : 'w-7 h-7 text-[11px]'
  return (
    <div className={`${sz} ${avatarColor(id)} rounded-full flex items-center justify-center text-white font-semibold shrink-0`}>
      {initials(name)}
    </div>
  )
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function PhotoIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Photo card ───────────────────────────────────────────────────────────────

function PhotoCard({
  photo,
  onClick,
  onUnapprove,
}: {
  photo: ApprovedPhoto
  onClick: () => void
  onUnapprove: (photo: ApprovedPhoto) => void
}) {
  return (
    <div className="relative group rounded-xl overflow-hidden bg-gray-100 aspect-square">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.fileName}
        className="w-full h-full object-cover cursor-pointer"
        onClick={onClick}
      />

      {/* Instructor avatar — always visible */}
      <div className="absolute top-2 left-2">
        <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full pl-0.5 pr-2 py-0.5">
          <InstructorAvatar id={photo.instructorId} name={photo.instructorName} size="xs" />
          <span className="text-white text-[9px] font-medium leading-none max-w-[80px] truncate">
            {photo.instructorName.split(' ')[0]}
          </span>
        </div>
      </div>

      {/* Hover overlay */}
      <div
        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2.5 gap-1.5 cursor-pointer"
        onClick={onClick}
      >
        <p className="text-white/70 text-[10px] truncate">{photo.fileName}</p>
        <button
          onClick={e => { e.stopPropagation(); onUnapprove(photo) }}
          className="w-full text-[10px] font-semibold bg-white/20 hover:bg-red-500/80 text-white rounded-lg py-1.5 transition-colors"
        >
          Remove from social
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ApprovedPhotosGallery({ studioId, token }: { studioId: string; token: string }) {
  const [photos, setPhotos]   = useState<ApprovedPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<string>('all')   // 'all' | instructorId
  const [lightbox, setLightbox] = useState<ApprovedPhoto | null>(null)
  const [unapproving, setUnapproving] = useState<string | null>(null)

  useEffect(() => {
    api.photos.approvedByStudio(studioId, token)
      .then(setPhotos)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [studioId, token])

  // Derive unique instructors from the photos list
  const instructors = Array.from(
    photos.reduce((map, p) => {
      if (!map.has(p.instructorId)) map.set(p.instructorId, p.instructorName)
      return map
    }, new Map<string, string>())
  ).map(([id, name]) => ({ id, name }))

  const visible = filter === 'all' ? photos : photos.filter(p => p.instructorId === filter)

  async function handleUnapprove(photo: ApprovedPhoto) {
    setUnapproving(photo.id)
    try {
      await api.photos.toggleApproval(photo.instructorId, photo.id, false, token)
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
      if (lightbox?.id === photo.id) setLightbox(null)
      // If the current filter instructor has no more photos, reset to all
      if (filter !== 'all') {
        const remaining = photos.filter(p => p.id !== photo.id && p.instructorId === filter)
        if (remaining.length === 0) setFilter('all')
      }
    } catch { /* silent */ }
    finally { setUnapproving(null) }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-8 w-20 bg-gray-100 rounded-full animate-pulse" />)}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="aspect-square bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (photos.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-2xl py-16 flex flex-col items-center justify-center gap-3">
        <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
          <PhotoIcon />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">No approved photos yet</p>
          <p className="text-xs text-gray-400 mt-0.5">Instructors can mark photos as approved for social media from their photo repository</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Instructor filter pills */}
      {instructors.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              filter === 'all'
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            All
            <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${filter === 'all' ? 'bg-white/20' : 'bg-gray-100'}`}>
              {photos.length}
            </span>
          </button>

          {instructors.map(inst => {
            const count = photos.filter(p => p.instructorId === inst.id).length
            const isActive = filter === inst.id
            return (
              <button
                key={inst.id}
                onClick={() => setFilter(isActive ? 'all' : inst.id)}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isActive
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                <InstructorAvatar id={inst.id} name={inst.name} size="xs" />
                {inst.name.split(' ')[0]}
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${isActive ? 'bg-white/20' : 'bg-gray-100'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Count */}
      <p className="text-sm text-gray-500">
        {visible.length === photos.length
          ? `${photos.length} photo${photos.length !== 1 ? 's' : ''} approved for social media`
          : `${visible.length} of ${photos.length} photo${photos.length !== 1 ? 's' : ''} · ${instructors.find(i => i.id === filter)?.name}`}
      </p>

      {/* Grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {visible.map(photo => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            onClick={() => setLightbox(photo)}
            onUnapprove={handleUnapprove}
          />
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-3xl w-full" onClick={e => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.url}
              alt={lightbox.fileName}
              className="w-full max-h-[80vh] object-contain rounded-xl"
            />
            <div className="mt-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 min-w-0">
                <InstructorAvatar id={lightbox.instructorId} name={lightbox.instructorName} />
                <div className="min-w-0">
                  <p className="text-white font-medium text-sm">{lightbox.instructorName}</p>
                  <p className="text-white/60 text-xs truncate">{lightbox.fileName}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => handleUnapprove(lightbox)}
                  disabled={unapproving === lightbox.id}
                  className="text-xs font-medium bg-white/20 hover:bg-red-500/80 text-white px-4 py-2 rounded-lg transition-colors disabled:opacity-40"
                >
                  {unapproving === lightbox.id ? 'Removing…' : 'Remove from social'}
                </button>
                <a
                  href={lightbox.url}
                  download={lightbox.fileName}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium bg-white text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-100 transition-colors"
                  onClick={e => e.stopPropagation()}
                >
                  Download
                </a>
                <button
                  onClick={() => setLightbox(null)}
                  className="text-xs font-medium bg-white/20 text-white px-4 py-2 rounded-lg hover:bg-white/30 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
