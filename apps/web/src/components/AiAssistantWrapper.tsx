'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import AiAssistant from './AiAssistant'
import { api } from '@/lib/api-client'

export default function AiAssistantWrapper() {
  const [token, setToken] = useState<string | null>(null)
  const [studioId, setStudioId] = useState<string | null>(null)
  const [studioName, setStudioName] = useState<string | undefined>(undefined)

  useEffect(() => {
    const supabase = createClient()

    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      setToken(session.access_token)

      const id = process.env.NEXT_PUBLIC_STUDIO_ID
      if (!id) return
      setStudioId(id)

      try {
        const studio = await api.studios.get(id, session.access_token)
        setStudioName(studio.name ?? undefined)
      } catch { /* non-fatal */ }
    }

    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (!token || !studioId) return null

  return <AiAssistant token={token} studioId={studioId} studioName={studioName} />
}
