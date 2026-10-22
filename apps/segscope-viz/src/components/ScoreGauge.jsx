// 360-体检分 风格的环形评分表盘。
const toneColor = { good: '#00875a', warn: '#b86e00', bad: '#cf382d' }

export default function ScoreGauge({ score, grade, size = 160 }) {
  const r = size / 2 - 12
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, score)) / 100
  const color = toneColor[grade?.tone] || '#ff6a00'
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={10} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={10}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: 'stroke-dashoffset .8s ease' }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-4xl font-semibold tabular-nums" style={{ color }}>{Math.round(score)}</span>
        <span className="text-xs text-muted">就绪度评分</span>
        {grade && <span className="mt-1 text-sm font-medium" style={{ color }}>{grade.label}</span>}
      </div>
    </div>
  )
}
