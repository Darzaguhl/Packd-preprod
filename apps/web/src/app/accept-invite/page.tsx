'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api } from '@/lib/api-client'

const ROLE_LABELS: Record<string, string> = {
  studio_admin: 'Studio Admin',
  instructor: 'Instructor',
  fronthost: 'Front Desk',
}

function roleLabel(role: string) {
  return ROLE_LABELS[role] ?? role
}

function AcceptInviteInner() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const invitedEmail = searchParams.get('email') ?? ''
  const studioName   = searchParams.get('studio') ?? 'a studio'
  const studioId     = searchParams.get('studioId') ?? ''
  const role         = searchParams.get('role') ?? ''
  const inviteToken  = searchParams.get('token') ?? ''

  const [session, setSession] = useState<{ email: string; token: string } | null | undefined>(undefined)
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_up')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session: s } }) => {
      if (s) setSession({ email: s.user.email ?? '', token: s.access_token })
      else setSession(null)
    })
  }, [])

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthLoading(true)
    setAuthError(null)
    const supabase = createClient()
    const { error } = mode === 'sign_up'
      ? await supabase.auth.signUp({ email: invitedEmail, password })
      : await supabase.auth.signInWithPassword({ email: invitedEmail, password })
    if (error) {
      setAuthError(error.message)
      setAuthLoading(false)
      return
    }
    const { data: { session: s } } = await supabase.auth.getSession()
    if (s) setSession({ email: s.user.email ?? '', token: s.access_token })
    setAuthLoading(false)
  }

  async function handleAccept() {
    if (!session) return
    setAccepting(true)
    setAcceptError(null)
    try {
      await api.staff.acceptInvite({ studioId, role, invitedEmail, token: inviteToken }, session.token)
      setDone(true)
      // Refresh token so role is picked up, then redirect
      await createClient().auth.refreshSession()
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (e) {
      setAcceptError(e instanceof Error ? e.message : 'Failed to accept invitation')
    } finally {
      setAccepting(false)
    }
  }

  async function handleSignOut() {
    await createClient().auth.signOut()
    setSession(null)
  }

  // Guard: missing token means the link is invalid or was generated before this fix
  if (!inviteToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center space-y-3">
          <p className="text-sm font-medium text-gray-900">Invalid invitation link</p>
          <p className="text-xs text-gray-500">This link is missing a security token. Please ask the studio admin to resend the invitation.</p>
        </div>
      </div>
    )
  }

  // Still loading session
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
      </div>
    )
  }

  const emailMatch = session && session.email.toLowerCase() === invitedEmail.toLowerCase()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">

        {/* Invitation header */}
        <div className="text-center space-y-1">
          <div className="w-12 h-12 rounded-2xl bg-gray-900 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900">You've been invited</h1>
          <p className="text-sm text-gray-500">
            Join <span className="font-medium text-gray-800">{studioName}</span> as{' '}
            <span className="font-medium text-gray-800">{roleLabel(role)}</span>
          </p>
          <p className="text-xs text-gray-400">{invitedEmail}</p>
        </div>

        {done ? (
          <div className="text-center space-y-2 py-2">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900">Invitation accepted!</p>
            <p className="text-xs text-gray-400">Taking you to your dashboard…</p>
          </div>
        ) : session && emailMatch ? (
          /* Signed in with matching email — show accept button */
          <div className="space-y-4">
            <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5">
              <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 shrink-0">
                {session.email[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">Signed in as</p>
                <p className="text-sm font-medium text-gray-900 truncate">{session.email}</p>
              </div>
            </div>
            {acceptError && <p className="text-sm text-red-600">{acceptError}</p>}
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="w-full bg-gray-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {accepting ? 'Accepting…' : `Accept & join ${studioName}`}
            </button>
          </div>
        ) : session && !emailMatch ? (
          /* Signed in with wrong email */
          <div className="space-y-4">
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-700">
              You're signed in as <strong>{session.email}</strong>, but this invitation is for <strong>{invitedEmail}</strong>.
              Sign out and use the correct account to accept.
            </div>
            <button
              onClick={handleSignOut}
              className="w-full border border-gray-200 text-gray-700 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        ) : (
          /* Not signed in — show auth form */
          <form onSubmit={handleAuth} className="space-y-4">
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
              {(['sign_up', 'sign_in'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m === 'sign_up' ? 'Create account' : 'Sign in'}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={invitedEmail}
                readOnly
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-500 cursor-not-allowed"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'sign_up' ? 'Choose a password' : 'Your password'}
                required
                minLength={6}
                autoFocus
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
              />
            </div>

            {authError && <p className="text-sm text-red-600">{authError}</p>}

            <button
              type="submit"
              disabled={authLoading || !password}
              className="w-full bg-gray-900 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {authLoading ? '…' : mode === 'sign_up' ? 'Create account & continue' : 'Sign in & continue'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteInner />
    </Suspense>
  )
}
