import { useEffect, useState } from 'react'
import { Stack, useRouter, useSegments } from 'expo-router'
import { supabase } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    // Always clear loading — even if Supabase env vars are missing/wrong
    supabase.auth.getSession()
      .then(({ data: { session } }) => setSession(session))
      .catch(() => {})
      .finally(() => setLoading(false))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (loading) return
    const inAuthGroup = segments[0] === '(auth)'
    const inTabsGroup = segments[0] === '(tabs)'
    const inSession   = segments[0] === 'session'
    const isSettled   = inAuthGroup || inTabsGroup || inSession

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (session && !isSettled) {
      // logged in but sitting on the root index — send to schedule
      router.replace('/(tabs)/schedule')
    } else if (session && inAuthGroup) {
      router.replace('/(tabs)/schedule')
    }
  }, [session, loading, segments])

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)/login" options={{ headerShown: false }} />
      <Stack.Screen name="session/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
      <Stack.Screen name="+not-found" options={{ headerShown: false }} />
    </Stack>
  )
}
