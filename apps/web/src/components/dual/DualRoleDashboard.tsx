'use client'

import { useRouter, useSearchParams } from 'next/navigation'
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
  const router = useRouter()
  const searchParams = useSearchParams()

  const mode: Mode = searchParams.get('mode') === 'instructor' ? 'instructor' : 'frontdesk'

  function switchMode(next: Mode) {
    // Preserve existing params but reset view-specific ones that don't carry across modes
    const params = new URLSearchParams()
    params.set('mode', next)
    router.replace(`?${params.toString()}`)
  }

  const switcher = <ModeSwitcher mode={mode} onSwitch={switchMode} />

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
