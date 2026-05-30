'use client'

import { useState, useEffect, useRef } from 'react'
import { api, type InstructorPhoto } from '@/lib/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  // The Instructor record id (not userId)
  instructorId: string
  token: string
  // If true the caller is a manager (no delete, can upload on behalf)
  isManager?: boolean
  // Member id — when provided (self-view only) the headshot section is shown
  memberId?: string
  // Current headshot URL
  avatarUrl?: string | null
  // Called after a new headshot is uploaded so the parent can update its avatar display
  onAvatarChange?: (url: string) => void
}

// ─── Photo card ───────────────────────────────────────────────────────────────

function PhotoCard({
  photo,
  isManager,
  onToggleApproval,
  onDelete,
}: {
  photo: InstructorPhoto
  isManager: boolean
  onToggleApproval: (photo: InstructorPhoto) => void
  onDelete: (photo: InstructorPhoto) => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div className="relative group rounded-xl overflow-hidden bg-gray-100 aspect-square">
      {/* Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.url}
        alt={photo.fileName}
        className="w-full h-full object-cover"
      />

      {/* Social badge */}
      {photo.approvedForSocial && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-emerald-500 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">
          <CheckIcon />
          Social
        </div>
      )}

      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2.5 gap-1.5">
        <p className="text-white text-[11px] font-medium truncate">{photo.fileName}</p>

        <div className="flex gap-1.5">
          {/* Approve toggle */}
          <button
            onClick={() => onToggleApproval(photo)}
            className={`flex-1 flex items-center justify-center gap-1 text-[10px] font-semibold rounded-lg px-2 py-1.5 transition-colors ${
              photo.approvedForSocial
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            <CheckIcon />
            {photo.approvedForSocial ? 'Approved' : 'Approve'}
          </button>

          {/* Delete — instructor only */}
          {!isManager && (
            confirmDelete ? (
              <div className="flex gap-1">
                <button
                  onClick={() => onDelete(photo)}
                  className="text-[10px] font-semibold bg-red-500 text-white rounded-lg px-2 py-1.5 hover:bg-red-600"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[10px] font-semibold bg-white/20 text-white rounded-lg px-2 py-1.5 hover:bg-white/30"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center justify-center bg-white/20 text-white rounded-lg p-1.5 hover:bg-red-500/80 transition-colors"
              >
                <TrashIcon />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PhotosTab({ instructorId, token, isManager = false, memberId, avatarUrl: initialAvatarUrl, onAvatarChange }: Props) {
  const [photos, setPhotos]     = useState<InstructorPhoto[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [toast, setToast]       = useState<{ msg: string; ok: boolean } | null>(null)
  const [avatarUrl, setAvatarUrl] = useState<string | null | undefined>(initialAvatarUrl)
  const [uploadingHeadshot, setUploadingHeadshot] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const headshotInputRef = useRef<HTMLInputElement>(null)

  async function handleHeadshotSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !memberId) return
    e.target.value = ''
    setUploadingHeadshot(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const { avatarUrl: url } = await api.staff.uploadAvatar(memberId, { base64, fileName: file.name, contentType: file.type }, token)
      setAvatarUrl(url)
      onAvatarChange?.(url)
      showToast('Headshot updated')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', false)
    } finally {
      setUploadingHeadshot(false)
    }
  }

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  useEffect(() => {
    api.photos.list(instructorId, token)
      .then(setPhotos)
      .catch(() => showToast('Failed to load photos', false))
      .finally(() => setLoading(false))
  }, [instructorId, token])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    e.target.value = ''

    const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const invalid = files.filter(f => !ALLOWED.includes(f.type))
    if (invalid.length > 0) {
      showToast(`${invalid.length} file(s) skipped — only JPEG, PNG, WebP or GIF allowed`, false)
    }
    const oversized = files.filter(f => f.size > 10 * 1024 * 1024)
    if (oversized.length > 0) {
      showToast(`${oversized.length} file(s) skipped — max 10 MB each`, false)
    }
    const valid = files.filter(f => ALLOWED.includes(f.type) && f.size <= 10 * 1024 * 1024)
    if (valid.length === 0) return

    setUploadProgress({ done: 0, total: valid.length })
    const uploaded: typeof photos = []

    for (const file of valid) {
      try {
        // Read file as base64 — safe for large files via FileReader
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const photo = await api.photos.upload(
          instructorId,
          { base64, fileName: file.name, contentType: file.type },
          token,
        )
        uploaded.push(photo)
      } catch (err) {
        showToast(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'unknown error'}`, false)
      }
      setUploadProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null)
    }

    if (uploaded.length > 0) {
      setPhotos(prev => [...uploaded.reverse(), ...prev])
      showToast(uploaded.length === 1 ? 'Photo uploaded' : `${uploaded.length} photos uploaded`)
    }
    setUploadProgress(null)
  }

  async function handleToggleApproval(photo: InstructorPhoto) {
    try {
      const updated = await api.photos.toggleApproval(instructorId, photo.id, !photo.approvedForSocial, token)
      setPhotos(prev => prev.map(p => p.id === photo.id ? updated : p))
    } catch {
      showToast('Failed to update approval', false)
    }
  }

  async function handleDelete(photo: InstructorPhoto) {
    try {
      await api.photos.delete(instructorId, photo.id, token)
      setPhotos(prev => prev.filter(p => p.id !== photo.id))
      showToast('Photo deleted')
    } catch {
      showToast('Failed to delete photo', false)
    }
  }

  const approved = photos.filter(p => p.approvedForSocial)
  const other    = photos.filter(p => !p.approvedForSocial)

  if (loading) {
    return (
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="aspect-square bg-gray-100 rounded-xl animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* ── Headshot — only shown in self-view when memberId is available ── */}
      {!isManager && memberId && (
        <div className="flex items-center gap-5 p-4 bg-gray-50 rounded-2xl border border-gray-100">
          {/* Avatar preview */}
          <div className="w-20 h-20 rounded-full relative overflow-hidden shrink-0 bg-gray-200">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="Headshot" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 mb-0.5">Profile headshot</p>
            <p className="text-xs text-gray-400 mb-3">Shown in your avatar across the platform.</p>
            <label className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer transition-colors ${
              uploadingHeadshot
                ? 'bg-gray-100 text-gray-400 pointer-events-none'
                : 'bg-gray-900 text-white hover:bg-gray-700'
            }`}>
              {uploadingHeadshot ? (
                <>
                  <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Uploading…
                </>
              ) : (
                <>{avatarUrl ? 'Change headshot' : 'Upload headshot'}</>
              )}
              <input
                ref={headshotInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={handleHeadshotSelect}
                disabled={uploadingHeadshot}
              />
            </label>
          </div>
        </div>
      )}

      {/* Upload button */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {photos.length === 0
              ? 'No photos yet.'
              : `${photos.length} photo${photos.length !== 1 ? 's' : ''} · ${approved.length} approved for social`}
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!!uploadProgress}
          className="flex items-center gap-2 text-xs font-medium bg-gray-900 text-white px-4 py-2 rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
        >
          {uploadProgress ? (
            <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <UploadIcon />
          )}
          {uploadProgress
            ? `Uploading ${uploadProgress.done}/${uploadProgress.total}…`
            : 'Upload photos'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {photos.length === 0 ? (
        <div
          className="border-2 border-dashed border-gray-200 rounded-2xl py-16 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-gray-300 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
            <UploadIcon />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Upload photos</p>
            <p className="text-xs text-gray-400 mt-0.5">Select one or more · JPEG, PNG, WebP or GIF · max 10 MB each</p>
          </div>
        </div>
      ) : (
        <>
          {/* Approved for social */}
          {approved.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Approved for social media
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                {approved.map(photo => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    isManager={isManager}
                    onToggleApproval={handleToggleApproval}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other photos */}
          {other.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {approved.length > 0 ? 'Other photos' : 'Photos'}
              </h3>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                {other.map(photo => (
                  <PhotoCard
                    key={photo.id}
                    photo={photo}
                    isManager={isManager}
                    onToggleApproval={handleToggleApproval}
                    onDelete={handleDelete}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg z-50 ${
          toast.ok ? 'bg-gray-900 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
