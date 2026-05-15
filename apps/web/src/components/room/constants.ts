import type { StationType } from '@/lib/api'

export const STATION_META: Record<StationType, { label: string; icon: string; color: string; w: number; h: number }> = {
  BIKE:       { label: 'Bike',       icon: '🚴', color: 'bg-violet-100 border-violet-300 text-violet-800', w: 1.2, h: 0.8 },
  TREADMILL:  { label: 'Treadmill',  icon: '🏃', color: 'bg-blue-100 border-blue-300 text-blue-800',     w: 1.6, h: 0.7 },
  BENCH:      { label: 'Bench',      icon: '🪑', color: 'bg-amber-100 border-amber-300 text-amber-800',  w: 1.2, h: 0.5 },
  ROWER:      { label: 'Rower',      icon: '🚣', color: 'bg-cyan-100 border-cyan-300 text-cyan-800',     w: 1.8, h: 0.6 },
  MAT:        { label: 'Mat',        icon: '🟩', color: 'bg-emerald-100 border-emerald-300 text-emerald-800', w: 1.4, h: 0.6 },
  REFORMER:   { label: 'Reformer',   icon: '⬛', color: 'bg-gray-100 border-gray-400 text-gray-800',    w: 2.2, h: 0.7 },
  BARRE:      { label: 'Barre',      icon: '━',  color: 'bg-pink-100 border-pink-300 text-pink-800',     w: 2.0, h: 0.3 },
  OTHER:      { label: 'Other',      icon: '⬡',  color: 'bg-gray-100 border-gray-300 text-gray-600',    w: 1.0, h: 1.0 },
}

export const STATION_TYPES: StationType[] = ['BIKE', 'TREADMILL', 'BENCH', 'ROWER', 'MAT', 'REFORMER', 'BARRE', 'OTHER']

export const GRID_STEP = 0.5 // snap to 0.5m grid

export function snapToGrid(val: number): number {
  return Math.round(val / GRID_STEP) * GRID_STEP
}
