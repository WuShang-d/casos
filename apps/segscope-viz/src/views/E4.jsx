import { Kpi, Panel, SectionTitle } from '../components/ui.jsx'
import { OverheadBars } from '../components/charts.jsx'

const modeNames = { branch: '关键步骤检查', once: '单次检查', block: '分段检查', full: '完整检查', none: '未添加干扰', noipi: '未添加干扰', kthread: '后台干扰' }
const modeName = (value, simple) => simple ? modeNames[value] || value || '—' : value || '—'
const pct = (value) => value == null ? '—' : value.toFixed(2)

export default function E4({ data, simple = false }) {
  const valid = data.rows.filter((r) => r.valid)
  const overheads = valid.map((r) => r.overhead).filter((v) => v !== null)
  const bloats = valid.map((r) => r.bloat).filter((v) => v !== null)
  const avg = overheads.length ? overheads.reduce((s, v) => s + v, 0) / overheads.length : null
  return (
    <div>
      <SectionTitle eyebrow={simple ? undefined : 'E4 · Interrupt Detection'} title={simple ? '异常干扰防护检查结果' : '编译器防御开销'}>{simple ? '比较加入保护前后的程序耗时和大小。只统计两次运行都成功的记录，缺失结果以 — 表示。' : '汇总导入的基准结果。缺失指标显示为 —；只有插桩和基线返回码均为 0 的记录参与图表与统计。'}</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="指标记录数" value={data.rows.length} sub={`${valid.length} 条运行成功；${data.rows.length - valid.length} 条失败或状态未确认`} />
        <Kpi label="平均耗时变化" value={pct(avg)} unit={avg === null ? '' : '%'} sub={`${overheads.length} 条有效记录，算术均值`} tone="good" />
        <Kpi label="最大耗时变化" value={pct(overheads.length ? Math.max(...overheads) : null)} unit={overheads.length ? '%' : ''} tone="warn" />
        <Kpi label="最大文件大小变化" value={pct(bloats.length ? Math.max(...bloats) : null)} unit={bloats.length ? '%' : ''} tone="accent2" />
      </div>
      {!!valid.length && <Panel className="mt-4" title="程序耗时和文件大小变化" desc="显示前 30 条成功记录，全部记录见下表；未跨模式或重复实验合并。"><OverheadBars simple={simple} rows={valid.slice(0, 30).map((r, i) => ({ ...r, name: `${i + 1}. ${r.library} ${r.algorithm} ${modeName(r.instrument_mode, simple)}/${modeName(r.ipi_mode, simple)}` }))} /></Panel>}
      {!!data.rows.length && <Panel className="mt-4" title="检查结果明细" desc="变化比例以未加入保护的版本为参照；负数表示耗时减少或文件变小。">
        <div className="max-h-[500px] overflow-auto"><table className="w-full whitespace-nowrap text-left text-xs tabular-nums"><thead className="text-muted"><tr>{(simple ? ['程序 / 版本', '处理内容', '保护设置', '耗时变化 %', '主要步骤耗时变化 %', '大小变化 %', '运行状态', '记录来源'] : ['库 / 版本', '算法 / case', '插桩 / IPI', '运行开销 %', '函数开销 %', '膨胀 %', '返回码 插桩/基线', '来源']).map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>{data.rows.map((r, i) => <tr key={i} className="border-t border-edge/40"><td className="p-2">{r.library} {r.version}</td><td className="p-2">{r.algorithm} / {r.case}</td><td className="p-2">{modeName(r.instrument_mode, simple)} / {modeName(r.ipi_mode, simple)}</td><td className="p-2 text-accent">{pct(r.overhead)}</td><td className="p-2">{pct(r.funcOverhead)}</td><td className="p-2 text-accent2">{pct(r.bloat)}</td><td className={`p-2 ${r.valid ? 'text-good' : 'text-warn'}`}>{simple ? (r.valid ? '两组运行成功' : '失败或未确认') : `${r.rc || '—'} / ${r.rc_base || '—'}`}</td><td className="max-w-xs truncate p-2 text-muted" title={r.source}>{r.source}</td></tr>)}</tbody></table></div>
      </Panel>}
      {!!data.manifest.length && <Panel className="mt-4" title={`任务清单 · ${data.manifest.length} 条`} desc="manifest.tsv 不含开销指标。索引中的路径仅展示，不会访问本机文件或下载远程文件。">
        {!data.rows.length && <p className="mb-3 text-sm text-warn">已导入任务索引。请同时选择对应的 known_cases_results.tsv，或选择完整结果目录，才能绘制开销图。</p>}
        <div className="max-h-80 overflow-auto"><table className="w-full text-left text-xs"><thead className="text-muted"><tr>{(simple ? ['运行分组', '保护设置', '重复次数', '状态', '结果文件'] : ['variant', '插桩模式', 'repeat', '状态', '结果文件']).map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{data.manifest.map((r, i) => <tr key={i} className="border-t border-edge/40"><td className="p-2">{modeName(r.variant, simple)}</td><td className="p-2">{modeName(r.instr_mode, simple)}</td><td className="p-2">{r.repeat_id}</td><td className={`p-2 ${r.status === 'ok' ? 'text-good' : 'text-warn'}`}>{simple ? r.status === 'ok' ? '成功' : r.status === 'failed' ? '失败' : r.status : r.status}</td><td className="break-all p-2 text-muted">{r.result_tsv}</td></tr>)}</tbody></table></div>
      </Panel>}
    </div>
  )
}
