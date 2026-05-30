import { Suspense } from 'react'
import ScheduleView from '@/components/ScheduleView'

export default async function SchedulePage() {
  return (
    <Suspense>
      <ScheduleView studioId={process.env.NEXT_PUBLIC_STUDIO_ID!} />
    </Suspense>
  )
}
