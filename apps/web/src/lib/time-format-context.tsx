'use client'

import { createContext, useContext } from 'react'
import type { TimeFormat } from './fmt-time'

const TimeFormatContext = createContext<TimeFormat>('24h')

export function useTimeFormat(): TimeFormat {
  return useContext(TimeFormatContext)
}

export function TimeFormatProvider({
  value,
  children,
}: {
  value: TimeFormat
  children: React.ReactNode
}) {
  return <TimeFormatContext.Provider value={value}>{children}</TimeFormatContext.Provider>
}
