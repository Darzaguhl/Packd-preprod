'use client'

import { useState } from 'react'
import FronthostDashboard from '@/components/fronthost/FronthostDashboard'
import StudioManagerDashboard from '@/components/studio/StudioManagerDashboard'

// ─── Types ────────────────────────────────────────────────────────────────────

type Mode = 'management' | 'frontdesk'

// ─── Mode switcher pill ───────────────────────────────────────────────────────

function ModeSwitcher({ mode, onSwitch }: { mode: Mode; onSwitch: (m: Mode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => onSwitch('management')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'management'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Management
      </button>
      <button
        onClick={() => onSwitch('frontdesk')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'frontdesk'
            ? 'bg-white text-gray-900 shadow-sm'
            : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Front Desk
      </button>
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  studioId: string
  studioName?: string
  /** Called when navigating back (franchise drill-in only) */
  onBack?: () => void
  /** Called after studio settings are saved — lets the parent keep its studio list in sync */
  onStudioUpdate?: (data: { name: string; timezone: string; currency: string; timeFormat: string }) => void
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export default function AdminShell({ studioId, studioName, onBack, onStudioUpdate }: Props) {
  const [mode, setMode] = useState<Mode>('management')

  const switcher = <ModeSwitcher mode={mode} onSwitch={setMode} />

  if (mode === 'frontdesk') {
    return (
      <FronthostDashboard
        defaultStudioId={studioId}
        modeSwitch={switcher}
      />
    )
  }

  return (
    <StudioManagerDashboard
      studioId={studioId}
      studioName={studioName}
      onBack={onBack}
      onStudioUpdate={onStudioUpdate}
      modeSwitch={switcher}
    />
  )
}
