'use client'

import { createContext, useContext } from 'react'

/** Studio timezone string, e.g. "Europe/Stockholm". Falls back to browser locale if not set. */
const TimezoneContext = createContext<string | undefined>(undefined)

export function useTimezone(): string | undefined {
  return useContext(TimezoneContext)
}

export function TimezoneProvider({
  value,
  children,
}: {
  value: string | undefined
  children: React.ReactNode
}) {
  return <TimezoneContext.Provider value={value}>{children}</TimezoneContext.Provider>
}
