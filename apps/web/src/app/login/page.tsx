'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

function roleHomePath(role: string | undefined): string {
  switch (role) {
    case 'admin':
      return '/platform'
    case 'brand_admin':
    case 'franchise_admin':
    case 'studio_admin':
    case 'instructor':
      return '/dashboard'
    case 'fronthost':
      return '/schedule'
    default:
      return '/schedule'
  }
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function PasswordInput({ id, value, onChange, autoFocus, placeholder }: {
  id?: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
  placeholder?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="w-full px-3 py-2 pr-10 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
      />
      <button
        type="button"
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 transition-colors"
        tabIndex={-1}
      >
        <EyeIcon open={show} />
      </button>
    </div>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'sign_in' | 'sign_up'>('sign_in')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [resetLoading, setResetLoading] = useState(false)

  // Password reset flow
  const [isRecovery, setIsRecovery] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  // Listen for Supabase to exchange the recovery token and establish a session.
  // PASSWORD_RECOVERY fires after the hash tokens are processed — safe to call updateUser then.
  useEffect(() => {
    const hash = window.location.hash

    // Explicit hash token handling — @supabase/ssr doesn't auto-process implicit flow tokens
    if (hash.includes('access_token')) {
      const params = new URLSearchParams(hash.slice(1))
      const accessToken = params.get('access_token')
      const refreshToken = params.get('refresh_token')
      const type = params.get('type')

      if (accessToken && refreshToken) {
        supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          .then(({ data: { session }, error }) => {
            if (error || !session) return
            if (type === 'recovery') {
              setIsRecovery(true)
            } else {
              const role = (session.user?.app_metadata as { role?: string } | undefined)?.role
              window.location.href = roleHomePath(role)
            }
          })
      }
      return
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true)
      } else if (event === 'SIGNED_IN') {
        if (session) {
          const role = (session.user?.app_metadata as { role?: string } | undefined)?.role
          window.location.href = roleHomePath(role)
        }
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } =
      mode === 'sign_in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })

    if (error) {
      setError(error.message)
    } else {
      const { data: { session } } = await supabase.auth.getSession()
      const role = (session?.user?.app_metadata as { role?: string } | undefined)?.role
      router.push(roleHomePath(role))
      router.refresh()
    }
    setLoading(false)
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setSavingPassword(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) {
      setError(error.message)
    } else {
      setPasswordSaved(true)
      window.history.replaceState(null, '', window.location.pathname)
    }
    setSavingPassword(false)
  }

  const Logo = () => (
    <div className="mb-6">
      <div className="flex items-baseline gap-1.5 mb-1">
        <span className="text-xl font-black leading-none select-none">⚡</span>
        <span className="text-3xl font-black italic tracking-tight leading-none text-gray-900">PACKD</span>
      </div>
    </div>
  )

  // ── Password reset form ──────────────────────────────────────────────────
  if (isRecovery) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <Logo />

          {passwordSaved ? (
            <div className="space-y-4">
              <p className="text-sm text-green-600 font-medium">Password updated successfully.</p>
              <button
                onClick={() => { setIsRecovery(false); setPasswordSaved(false) }}
                className="w-full bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
              >
                Sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <p className="text-sm text-gray-500 -mt-2 mb-4">Choose a new password for your account.</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                <PasswordInput value={newPassword} onChange={setNewPassword} autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                <PasswordInput value={confirmPassword} onChange={setConfirmPassword} />
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={savingPassword}
                className="w-full bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {savingPassword ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  // ── Normal login / sign up ───────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

        <Logo />
        <p className="text-sm text-gray-500 -mt-4 mb-6">
          {mode === 'sign_in' ? 'Sign in to your account' : 'Create an account'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">Password</label>
              {mode === 'sign_in' && (
                <button
                  type="button"
                  disabled={resetLoading}
                  onClick={async () => {
                    if (!email) { setError('Enter your email address first.'); return }
                    setResetLoading(true)
                    setError(null)
                    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                      redirectTo: `${window.location.origin}/login`,
                    })
                    if (resetError) {
                      setError(resetError.message)
                    } else {
                      setResetSent(true)
                    }
                    setResetLoading(false)
                  }}
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
                >
                  {resetLoading ? 'Sending…' : 'Forgot password?'}
                </button>
              )}
            </div>
            <PasswordInput id="password" value={password} onChange={setPassword} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {resetSent && <p className="text-sm text-green-600">Check your email for a password reset link.</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-2 rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Loading...' : mode === 'sign_in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === 'sign_in' ? 'sign_up' : 'sign_in')}
          className="mt-4 text-sm text-gray-500 hover:text-gray-900 w-full text-center"
        >
          {mode === 'sign_in' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
