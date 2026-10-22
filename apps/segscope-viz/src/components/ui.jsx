export function Kpi({ label, value, unit, sub, tone = 'accent' }) {
  const tones = {
    accent: 'text-accent',
    good: 'text-good',
    warn: 'text-warn',
    bad: 'text-bad',
    accent2: 'text-accent2',
  }
  return (
    <div className="card">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-3xl font-semibold tabular-nums ${tones[tone]}`}>{value}</span>
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  )
}

export function Panel({ title, desc, right, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-muted">{desc}</p>}
        </div>
        {right}
      </header>
      {children}
    </section>
  )
}

export function Provenance({ kind }) {
  const real = kind === 'real'
  return (
    <span
      className={`chip ${real ? 'border-good/40 text-good' : 'border-warn/40 text-warn'}`}
      title={real ? '数据取自 SegScope 仓库 / 论文 README' : '示例数据，形态与真实产物一致，可由真实运行结果替换'}
    >
      {real ? '真实数据' : '示例数据'}
    </span>
  )
}

export function SectionTitle({ eyebrow, title, children }) {
  return (
    <div className="mb-5">
      {eyebrow && <div className="text-xs font-medium uppercase tracking-widest text-accent">{eyebrow}</div>}
      <h2 className="mt-1 text-xl font-semibold text-slate-900">{title}</h2>
      {children && <p className="mt-1 max-w-3xl text-sm text-muted">{children}</p>}
    </div>
  )
}
