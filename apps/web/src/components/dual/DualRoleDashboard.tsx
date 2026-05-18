'use client'

import { useState } from 'react'
import FronthostDashboard from '@/components/fronthost/FronthostDashboard'
import StudioManagerDashboard from '@/components/studio/StudioManagerDashboard'

type Mode = 'frontdesk' | 'instructor'

interface Props {
  studioId: string
}

function ModeSwitcher({ mode, onSwitch }: { mode: Mode; onSwitch: (m: Mode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      <button
        onClick={() => onSwitch('frontdesk')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'frontdesk' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Front Desk
      </button>
      <button
        onClick={() => onSwitch('instructor')}
        className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
          mode === 'instructor' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
        }`}
      >
        Instructor
      </button>
    </div>
  )
}

export default function DualRoleDashboard({ studioId }: Props) {
  const [mode, setMode] = useState<Mode>('frontdesk')

  const switcher = <ModeSwitcher mode={mode} onSwitch={setMode} />

  return (
    <>
      {mode === 'frontdesk' ? (
        <FronthostDashboard defaultStudioId={studioId} modeSwitch={switcher} />
      ) : (
        <StudioManagerDashboard studioId={studioId} role="instructor" modeSwitch={switcher} />
      )}
    </>
  )
}
