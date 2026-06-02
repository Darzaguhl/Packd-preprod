'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { api, members as membersClient } from '@/lib/api-client'
import type { StudioSummary } from '@/lib/api-client'

import AdminShell from '@/components/admin/AdminShell'
import NavBar from '@/components/NavBar'
import AnalyticsTab from '@/components/studio/AnalyticsTab'

import StudiosTab from './tabs/StudiosTab'
import NetworksTab from './tabs/NetworksTab'
import BrandsTab from './tabs/BrandsTab'
import PromosTab from './tabs/PromosTab'
import BroadcastTab from './tabs/BroadcastTab'
import FranchiseStaffRoster from './FranchiseStaffRoster'
import FranchisePermissionsRoster from './FranchisePermissionsRoster'
import FranchiseAdminsRoster from './FranchiseAdminsRoster'

type Tab = 'studios' | 'admins' | 'staff' | 'permissions' | 'analytics' | 'networks' | 'brands' | 'promos' | 'broadcast'

export default function FranchiseDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [tab, setTab] = useState<Tab>(() => (searchParams.get('tab') as Tab) ?? 'studios')
  const [token, setToken] = useState<string | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [franchiseName, setFranchiseName] = useState<string | null>(null)
  const [studios, setStudios] = useState<StudioSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStudio, setActiveStudio] = useState<StudioSummary | null>(null)
  const [pendingStudioId] = useState<string | null>(() => searchParams.get('studio'))
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  function showToast(msg: string, ok = true) {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  function changeTab(next: Tab, studioId?: string) {
    setTab(next)
    const p = new URLSearchParams()
    p.set('tab', next)
    if (studioId) p.set('studio', studioId)
    router.replace(`?${p.toString()}`)
  }

  // Redirect away from admin-only tabs once role is known
  useEffect(() => {
    if (userRole !== null && userRole !== 'admin' && tab === 'brands') changeTab('studios')
  }, [userRole, tab])

  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      const t = session?.access_token ?? null
      setToken(t)
      const role = session?.user.app_metadata?.role ?? null
      setUserRole(role)
      if (!t) return setLoading(false)

      membersClient.ensure(t).catch(() => {})
      if (role === 'franchise_admin') {
        api.franchise.info(t).then(res => { if (res.name) setFranchiseName(res.name) }).catch(() => {})
      }

      api.franchise.studios(t).then(data => {
        setStudios(data)
        if (pendingStudioId) {
          const match = data.find(s => s.id === pendingStudioId)
          if (match) setActiveStudio(match)
        }
      }).finally(() => setLoading(false))
    })
  }, [])

  // Franchise admin with no studios yet → prompt onboarding
  if (!loading && userRole === 'franchise_admin' && studios.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <NavBar title={franchiseName ?? 'Franchise Dashboard'} subtitle="All studios" />
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 max-w-md w-full text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Set up your first studio</h2>
              <p className="text-sm text-gray-500 mt-1">
                Welcome to {franchiseName ?? 'your franchise'}! Complete the setup wizard to create your first studio, add rooms, and invite staff.
              </p>
            </div>
            <button
              onClick={() => router.push('/onboarding')}
              className="w-full py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-colors"
            >
              Start setup →
            </button>
            <p className="text-xs text-gray-400">Takes about 5 minutes</p>
          </div>
        </div>
      </div>
    )
  }

  // Drill-in: show full studio management shell
  if (activeStudio && token) {
    return (
      <AdminShell
        studioId={activeStudio.id}
        studioName={activeStudio.name}
        onBack={() => { setActiveStudio(null); changeTab('studios') }}
        onStudioUpdate={data => {
          setStudios(prev => prev.map(s => s.id === activeStudio.id ? { ...s, ...data } : s))
          setActiveStudio(prev => prev ? { ...prev, ...data } : prev)
        }}
      />
    )
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: 'studios', label: 'Studios' },
    ...(userRole === 'admin' ? [{ id: 'brands' as Tab, label: 'Brands' }] : []),
    { id: 'networks', label: 'Networks' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'promos', label: 'Promos' },
    { id: 'broadcast', label: 'Broadcast' },
    { id: 'admins', label: 'Studio Admins' },
    { id: 'staff', label: 'Staff' },
    { id: 'permissions', label: 'Permissions' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <NavBar title={franchiseName ?? 'Franchise Dashboard'} subtitle="All studios">
        <div className="flex gap-1 -mb-px">
          {TABS.map(t => (
            <button key={t.id} onClick={() => changeTab(t.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      </NavBar>

      {tab === 'studios' && token && (
        <StudiosTab
          studios={studios}
          loading={loading}
          token={token}
          showToast={showToast}
          onManageStudio={studio => { setActiveStudio(studio); changeTab('studios', studio.id) }}
          onStudioDeleted={id => {
            setStudios(prev => prev.filter(s => s.id !== id))
            if (activeStudio?.id === id) { setActiveStudio(null); changeTab('studios') }
          }}
        />
      )}

      {tab === 'brands' && token && <BrandsTab token={token} showToast={showToast} />}

      {tab === 'networks' && token && <NetworksTab studios={studios} token={token} showToast={showToast} />}

      {tab === 'analytics' && token && (
        <AnalyticsTab studioId="all" token={token} canQuery={false} studios={studios.map(s => ({ id: s.id, name: s.name }))} />
      )}

      {tab === 'promos' && token && (
        <PromosTab studioCount={studios.length} token={token} showToast={showToast} />
      )}

      {tab === 'broadcast' && token && (
        <BroadcastTab studios={studios} token={token} showToast={showToast} />
      )}

      {tab === 'admins' && token && (
        <div className="max-w-3xl mx-auto w-full px-6 py-6">
          {studios.length === 0
            ? <p className="text-sm text-gray-400">No studios yet. Create a studio first.</p>
            : <FranchiseAdminsRoster studios={studios} token={token} />}
        </div>
      )}

      {tab === 'staff' && token && (
        <div className="max-w-4xl mx-auto w-full px-6 py-6">
          <FranchiseStaffRoster token={token} />
        </div>
      )}

      {tab === 'permissions' && token && (
        <div className="max-w-5xl mx-auto w-full px-6 py-6">
          {studios.length > 0
            ? <FranchisePermissionsRoster studios={studios} token={token} />
            : <p className="text-sm text-gray-400 text-center py-16">No studios yet.</p>}
        </div>
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
