'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import StepStudioDetails from './StepStudioDetails'
import StepLocation from './StepLocation'
import StepClasses from './StepClasses'
import StepPolicy from './StepPolicy'
import StepDone from './StepDone'

export type OnboardingData = {
  studio: { name: string; slug: string; timezone: string; currency: string }
  location: { name: string; address: string; city: string; country: string }
  rooms: { name: string; capacity: number; sport: string }[]
  policy: { lateCancelWindowHours: number; lateCancelFeeCredits: number; noShowFeeCredits: number }
  studioId?: string
}

const STEPS = ['Studio', 'Location', 'Classes', 'Policy', 'Done']

export default function OnboardingFlow() {
  const [step, setStep] = useState(0)
  const [token, setToken] = useState<string | null>(null)
  const [data, setData] = useState<OnboardingData>({
    studio: { name: '', slug: '', timezone: 'UTC', currency: 'USD' },
    location: { name: '', address: '', city: '', country: '' },
    rooms: [{ name: 'Main Studio', capacity: 20, sport: 'CYCLING' }],
    policy: { lateCancelWindowHours: 12, lateCancelFeeCredits: 1, noShowFeeCredits: 1 },
  })
  const router = useRouter()

  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      setToken(session?.access_token ?? null)
    })
  }, [])

  function next(patch: Partial<OnboardingData>) {
    setData((prev) => ({ ...prev, ...patch }))
    setStep((s) => s + 1)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 py-12">
      {/* Progress */}
      <div className="w-full max-w-lg mb-8">
        <div className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                    i < step
                      ? 'bg-black text-white'
                      : i === step
                        ? 'bg-black text-white'
                        : 'bg-gray-200 text-gray-400'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${i <= step ? 'text-gray-900' : 'text-gray-400'}`}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px ${i < step ? 'bg-black' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        {step === 0 && <StepStudioDetails data={data} onNext={next} />}
        {step === 1 && <StepLocation data={data} onNext={next} onBack={() => setStep(0)} />}
        {step === 2 && <StepClasses data={data} onNext={next} onBack={() => setStep(1)} />}
        {step === 3 && <StepPolicy data={data} onNext={next} onBack={() => setStep(2)} token={token ?? ''} />}
        {step === 4 && <StepDone data={data} onFinish={() => router.push('/schedule')} />}
      </div>
    </div>
  )
}
