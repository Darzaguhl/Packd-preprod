'use client'

import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface Props {
  title: string
  subtitle?: string
  /** Element rendered left of the title (e.g. back button) */
  leading?: React.ReactNode
  /** Extra content rendered below the title+nav row (e.g. day tabs, filters) */
  children?: React.ReactNode
}

const ELEVATED = new Set(['admin', 'franchise_admin', 'studio_admin', 'instructor'])
const FRONTHOST = new Set(['fronthost'])

export default function NavBar({ title, subtitle, leading, children }: Props) {
  const [role, setRole] = useState<string | undefined>()
  const [displayName, setDisplayName] = useState<string | undefined>()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        const r = (session?.user?.app_metadata as { role?: string } | undefined)?.role
        setRole(r)
        const meta = session?.user?.user_metadata as { first_name?: string; full_name?: string } | undefined
        const name = meta?.first_name ?? meta?.full_name?.split(' ')[0] ?? session?.user?.email?.split('@')[0]
        setDisplayName(name)
      })
  }, [])

  async function handleLogout() {
    await createClient().auth.signOut()
    router.push('/login')
  }

  const isElevated = ELEVATED.has(role ?? '')
  const isFronthost = FRONTHOST.has(role ?? '')

  const navLinks: { label: string; href: string }[] = [
    { label: 'Schedule', href: '/schedule' },
    ...(isElevated ? [{ label: 'Dashboard', href: '/dashboard' }] : []),
    ...(isFronthost ? [{ label: 'Front Desk', href: '/fronthost' }] : []),
    { label: 'Account', href: '/account' },
  ]

  return (
    <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4">
        {/* Title + nav row */}
        <div className="flex items-center justify-between py-4">
          <div className="flex items-center gap-1 min-w-0">
            {leading}
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-gray-900 truncate">{title}</h1>
              {subtitle && <p className="text-sm text-gray-400">{subtitle}</p>}
            </div>
          </div>

          <nav className="flex items-center gap-5">
            {navLinks.map(({ label, href }) => {
              const active = pathname === href
              return (
                <a
                  key={href}
                  href={href}
                  className={`text-xs font-medium transition-colors ${
                    active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-700'
                  }`}
                >
                  {label}
                </a>
              )
            })}

            <button
              onClick={handleLogout}
              className="text-xs font-medium text-gray-400 hover:text-gray-700 transition-colors"
            >
              Log out{displayName && <span className="text-gray-300"> ({displayName})</span>}
            </button>
          </nav>
        </div>

        {/* Optional per-page content (tabs, filters, etc.) */}
        {children}
      </div>
    </div>
  )
}
