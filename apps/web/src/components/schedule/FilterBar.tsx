'use client'

import { SPORT_CONFIG } from './constants'

const ALL = 'ALL'

export default function FilterBar({
  available,
  selected,
  onSelect,
}: {
  available: string[]
  selected: string
  onSelect: (sport: string) => void
}) {
  const sports = [ALL, ...available]

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
      {sports.map((sport) => {
        const isSelected = sport === selected
        const cfg = SPORT_CONFIG[sport]
        return (
          <button
            key={sport}
            onClick={() => onSelect(sport)}
            data-testid="sport-filter"
            className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-full transition-all duration-150 ${
              isSelected
                ? sport === ALL
                  ? 'bg-black text-white'
                  : `${cfg.accent} text-white`
                : sport === ALL
                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  : `${cfg.bg} ${cfg.color} hover:opacity-80`
            }`}
          >
            {sport === ALL ? 'All classes' : cfg?.label ?? sport}
          </button>
        )
      })}
    </div>
  )
}
