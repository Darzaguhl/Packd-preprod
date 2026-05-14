'use client'

import type { OnboardingData } from './OnboardingFlow'

export default function StepDone({
  data,
  onFinish,
}: {
  data: OnboardingData
  onFinish: () => void
}) {
  return (
    <div className="text-center space-y-6">
      <div className="w-16 h-16 bg-black rounded-full flex items-center justify-center mx-auto">
        <span className="text-white text-2xl">✓</span>
      </div>
      <div>
        <h2 className="text-xl font-bold text-gray-900">{data.studio.name} is live</h2>
        <p className="text-sm text-gray-500 mt-1">
          Your studio is set up with {data.rooms.length} room{data.rooms.length !== 1 ? 's' : ''} at {data.location.name}.
          Start by adding class templates and building your schedule.
        </p>
      </div>

      <div className="text-left bg-gray-50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Next steps</p>
        <ul className="space-y-1.5 text-sm text-gray-700">
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs">1</span>
            Add class templates (Cycling 45, HIIT 50…)
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs">2</span>
            Invite instructors
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs">3</span>
            Schedule your first classes
          </li>
          <li className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full bg-gray-200 flex items-center justify-center text-xs">4</span>
            Connect Stripe to sell memberships
          </li>
        </ul>
      </div>

      <button
        onClick={onFinish}
        className="w-full bg-black text-white py-2.5 rounded-lg text-sm font-medium hover:bg-gray-800 transition-colors"
      >
        Go to dashboard
      </button>
    </div>
  )
}
