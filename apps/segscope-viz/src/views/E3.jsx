import { useState } from 'react'
import { Kpi, Panel, SectionTitle } from '../components/ui.jsx'
import { OffsetBars } from '../components/charts.jsx'

export default function E3({ data, simple = false }) {
  const [truthInput, setTruthInput] = useState('')
  const truth = /^\d+$/.test(truthInput) && Number(truthInput) < 512 ? Number(truthInput) : null
  const valid = truthInput === '' || truth !== null
  const top = data.top5[0]
  return (
    <div>
      <SectionTitle eyebrow={simple ? undefined : 'E3 · Breaking KASLR'} title={simple ? '重要位置检查结果' : 'KASLR 候选偏移分析'}>{simple ? '比较 512 个可能位置，列出分数最高的五个候选。提供独立确认的真实位置后，可以查看是否猜中。' : '原始 result-512 的行号对应偏移 0–511；按分数降序给出 Top-5。测量分数是 SegScope 计数，未经 CPU cycles 校准。'}</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="候选位置数量" value={data.measurements.length} />
        <Kpi label="排名第一的位置" value={`#${top.offset}`} tone="accent2" />
        <Kpi label="最高测量分数" value={top.score} tone="warn" />
        <Kpi label="真实位置核对" value={truth === null ? '未提供' : top.offset === truth ? '第一个猜测命中' : data.top5.some((r) => r.offset === truth) ? '前五个猜测命中' : '未命中'} tone={truth === null ? 'warn' : 'accent'} />
      </div>
      <div className="card mt-4">
        <label className="text-xs text-muted">已独立核验的真实位置编号（可选，0–511）
          <input aria-label="真实位置编号" type="number" min="0" max="511" step="1" value={truthInput} onChange={(e) => setTruthInput(e.target.value)} className="ml-3 w-28 rounded border border-edge bg-panel2 p-2 text-slate-900" />
        </label>
        {!valid && <p role="alert" className="mt-1 text-xs text-bad">请输入 0–511 的整数；当前不做真实位置核对。</p>}
      </div>
      <Panel className="mt-4" title="512 个候选位置的测量结果" desc="橙色柱标出你提供的真实位置；没有提供时不标记命中。">
        <OffsetBars data={data.measurements} truth={truth} valueKey="score" unit="测量分数" xLabel={simple ? '候选位置编号 (0–511)' : 'KASLR 候选偏移 (0–511)'} />
      </Panel>
      <Panel className="mt-4" title="排名靠前的五个位置" desc="同分时按位置编号排序；排名不代表已经猜对。">
        <div className="flex flex-wrap gap-3">{data.top5.map((row, i) => <div key={row.offset} className={`card min-w-[120px] ${row.offset === truth ? 'border-good/50' : ''}`}><div className="text-xs text-muted">#{i + 1}</div><div className="mt-1 text-xl text-slate-900">位置 {row.offset}</div><div className="mt-1 text-xs text-muted">{row.score} 分数 {row.offset === truth && '· 真实位置'}</div></div>)}</div>
      </Panel>
    </div>
  )
}
