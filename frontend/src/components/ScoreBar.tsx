interface ScoreBarProps {
  score: number
  color?: string
  showLabel?: boolean
}

function scoreToColor(score: number): string {
  if (score >= 75) return '#1D9E75'
  if (score >= 50) return '#EF9F27'
  return '#E24B4A'
}

export default function ScoreBar({ score, color, showLabel = true }: ScoreBarProps) {
  const clampedScore = Math.max(0, Math.min(100, score))
  const barColor = color ?? scoreToColor(clampedScore)

  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full transition-all duration-300"
          style={{ width: `${clampedScore}%`, backgroundColor: barColor }}
        />
      </div>
      {showLabel && (
        <span className="text-xs font-semibold w-8 text-right" style={{ color: barColor }}>
          {Math.round(clampedScore)}
        </span>
      )}
    </div>
  )
}
