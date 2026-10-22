import { computeReadiness } from '../lib/score.js'

const statusStyle = {
  yes: { dot: 'bg-good', ring: 'border-good/40', text: 'text-good', icon: '✓', label: '支持' },
  warn: { dot: 'bg-warn', ring: 'border-warn/40', text: 'text-warn', icon: '!', label: '受限' },
  no: { dot: 'bg-bad', ring: 'border-bad/40', text: 'text-bad', icon: '✕', label: '不支持' },
  info: { dot: 'bg-accent', ring: 'border-accent/40', text: 'text-accent', icon: 'i', label: '需工具链' },
}

function Spec({ label, value, badge }) {
  return (
    <div className="rounded-lg border border-edge bg-panel2/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-900">
        <span className="truncate">{value || '—'}</span>
        {badge}
      </div>
    </div>
  )
}

export default function ProbeResult({ target, facts, raw }) {
  const f = facts || {}
  const { bareMetal, experiments: exps, supported: yes } = computeReadiness(f)
  return (
    <div className="mt-4 rounded-xl border border-edge bg-panel2/50 p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-900">探测结果 · <span className="font-mono text-accent">{target}</span></div>
        <div className="chip border-accent/40 text-accent">{yes}/4 子实验可运行</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Spec label="CPU" value={f.MODEL} />
        <Spec label="厂商 / 架构" value={`${f.VENDOR || '—'} · ${f.ARCH || '—'}`} />
        <Spec label="核心数" value={f.NPROC} />
        <Spec label="系统" value={f.OS} />
        <Spec label="内核" value={f.KERNEL} />
        <Spec label="运行环境" value={bareMetal ? '裸机' : (f.VIRT || '未知')}
          badge={<span className={`h-1.5 w-1.5 rounded-full ${bareMetal ? 'bg-good' : 'bg-warn'}`} />} />
      </div>

      <div className="mt-4 text-xs font-semibold text-slate-900">SegScope 子实验适配</div>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {exps.map((e) => {
          const s = statusStyle[e.status]
          return (
            <div key={e.id} className={`flex items-start gap-3 rounded-lg border ${s.ring} bg-ink/30 px-3 py-2`}>
              <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.dot} text-xs font-bold text-ink`}>{s.icon}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono text-[11px] text-muted">{e.id}</span>
                  <span className="text-slate-900">{e.name}</span>
                  <span className={`text-[11px] ${s.text}`}>{s.label}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">{e.reason}</div>
              </div>
            </div>
          )
        })}
      </div>

      {raw && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] text-muted">原始探测输出</summary>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded bg-ink/60 p-2 text-[11px] text-muted">{raw.trim()}</pre>
        </details>
      )}
    </div>
  )
}
