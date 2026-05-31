import type { StationType } from './api'

export interface StationMeta {
  label: string
  short: string   // fallback when station.label is empty
  bg: string
  border: string
  text: string
  wM: number
  hM: number
}

export const STATION_META: Record<StationType, StationMeta> = {
  BIKE:      { label: 'Bike',      short: 'B',  bg: '#ede9fe', border: '#a78bfa', text: '#5b21b6', wM: 1.2, hM: 0.8 },
  TREADMILL: { label: 'Treadmill', short: 'T',  bg: '#dbeafe', border: '#60a5fa', text: '#1e40af', wM: 1.6, hM: 0.7 },
  BENCH:     { label: 'Bench',     short: 'Bn', bg: '#fef3c7', border: '#f59e0b', text: '#92400e', wM: 1.2, hM: 0.5 },
  ROWER:     { label: 'Rower',     short: 'R',  bg: '#cffafe', border: '#22d3ee', text: '#164e63', wM: 1.8, hM: 0.6 },
  MAT:       { label: 'Mat',       short: 'M',  bg: '#d1fae5', border: '#34d399', text: '#065f46', wM: 1.4, hM: 0.6 },
  REFORMER:  { label: 'Reformer',  short: 'Rf', bg: '#f3f4f6', border: '#9ca3af', text: '#1f2937', wM: 2.2, hM: 0.7 },
  BARRE:     { label: 'Barre',     short: 'Ba', bg: '#fce7f3', border: '#f9a8d4', text: '#9d174d', wM: 2.0, hM: 0.4 },
  OTHER:     { label: 'Spot',      short: 'S',  bg: '#f3f4f6', border: '#d1d5db', text: '#374151', wM: 1.0, hM: 1.0 },
}

export const SPORT_COLORS: Record<string, string> = {
  cycling:  '#7c3aed',
  hiit:     '#dc2626',
  yoga:     '#059669',
  pilates:  '#d97706',
  boxing:   '#0284c7',
  strength: '#7c3aed',
  barre:    '#db2777',
  default:  '#374151',
}

export function sportColor(sport: string): string {
  return SPORT_COLORS[sport?.toLowerCase()] ?? SPORT_COLORS.default
}
