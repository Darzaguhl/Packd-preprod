import { Suspense } from 'react'
import AccountView from '@/components/AccountView'

export default function AccountPage() {
  return (
    <Suspense>
      <AccountView />
    </Suspense>
  )
}
