import { useEffect, useRef } from 'react'
import { supabase } from './supabase'

/**
 * Calls `onReady` once — the first time a Supabase session is confirmed after
 * component mount. On cold start the session restores asynchronously from
 * AsyncStorage; on subsequent mounts it fires immediately if already signed in.
 */
export function useAuthReady(onReady: () => void) {
  const fired = useRef(false)

  useEffect(() => {
    // Check if session is already available right now
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !fired.current) {
        fired.current = true
        onReady()
      }
    })

    // Also listen for the auth event — catches the async restore on cold start
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !fired.current) {
        fired.current = true
        onReady()
      }
    })

    return () => subscription.unsubscribe()
  }, [])
}
