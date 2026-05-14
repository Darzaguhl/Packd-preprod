export default function CapacityBar({
  booked,
  capacity,
}: {
  booked: number
  capacity: number
}) {
  const pct = Math.min((booked / capacity) * 100, 100)
  const isFull = booked >= capacity
  const isAlmostFull = pct >= 80

  return (
    <div className="flex items-center gap-2" data-testid="capacity-bar">
      <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isFull ? 'bg-red-400' : isAlmostFull ? 'bg-amber-400' : 'bg-emerald-400'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs tabular-nums whitespace-nowrap ${isFull ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
        {isFull ? 'Full' : `${capacity - booked} left`}
      </span>
    </div>
  )
}
