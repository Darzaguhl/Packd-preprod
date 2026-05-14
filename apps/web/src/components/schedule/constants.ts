export const SPORT_CONFIG: Record<string, { color: string; bg: string; accent: string; label: string }> = {
  CYCLING:  { color: 'text-orange-600', bg: 'bg-orange-50',  accent: 'bg-orange-500', label: 'Cycling'  },
  HIIT:     { color: 'text-red-600',    bg: 'bg-red-50',     accent: 'bg-red-500',    label: 'HIIT'     },
  YOGA:     { color: 'text-emerald-600',bg: 'bg-emerald-50', accent: 'bg-emerald-500',label: 'Yoga'     },
  PILATES:  { color: 'text-purple-600', bg: 'bg-purple-50',  accent: 'bg-purple-500', label: 'Pilates'  },
  BARRE:    { color: 'text-pink-600',   bg: 'bg-pink-50',    accent: 'bg-pink-500',   label: 'Barre'    },
  ROWING:   { color: 'text-blue-600',   bg: 'bg-blue-50',    accent: 'bg-blue-500',   label: 'Rowing'   },
  STRENGTH: { color: 'text-slate-600',  bg: 'bg-slate-50',   accent: 'bg-slate-500',  label: 'Strength' },
  OTHER:    { color: 'text-gray-600',   bg: 'bg-gray-50',    accent: 'bg-gray-400',   label: 'Other'    },
}

export function sportConfig(sport: string) {
  return SPORT_CONFIG[sport] ?? SPORT_CONFIG.OTHER
}
