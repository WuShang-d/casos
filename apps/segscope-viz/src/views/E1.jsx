import { useState } from 'react'
import { Kpi, Panel, SectionTitle } from '../components/ui.jsx'
import { ConfusionMatrix, TraceChart } from '../components/charts.jsx'

export default function E1({ data, simple = false }) {
  const sites = [...new Set(data.traces.map((t) => t.site))]
  const [site, setSite] = useState(sites[0])
  const [run, setRun] = useState(0)
  const selectedSite = sites.includes(site) ? site : sites[0]
  const traces = data.traces.filter((t) => t.site === selectedSite)
  const samples = (traces[run] || traces[0]).samples
  const step = Math.max(1, Math.ceil(samples.length / 2000))
  const plotted = samples.flatMap((value, i) => i % step === 0 || i === samples.length - 1 ? [{ t: i, irq: value }] : [])
  return (
    <div>
      <SectionTitle eyebrow={simple ? undefined : 'E1 · Website Fingerprinting'} title={simple ? '网站检查结果' : '网站指纹识别'}>{simple ? '查看不同网站的运行记录。识别准确率来自本次检查报告。' : '展示采集或导入的原始 trace；分类准确率引用配套报告，不在浏览器内训练模型。'}</SectionTitle>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={simple ? '第一次猜测的准确率' : 'Top-1 准确率'} value={data.top1 ?? '—'} unit={data.top1 == null ? '' : '%'} sub={data.top1 == null ? '此报告未提供该指标' : '来自检查报告'} />
        <Kpi label={simple ? '前五个猜测包含正确答案' : 'Top-5 准确率'} value={data.top5 ?? '—'} unit={data.top5 == null ? '' : '%'} sub={data.top5 == null ? '此报告未提供该指标' : '来自检查报告'} tone="good" />
        <Kpi label="记录数量" value={data.traces.length} tone="accent2" />
        <Kpi label="站点数" value={sites.length} tone="warn" />
      </div>
      <Panel className="mt-4" title="网站访问的运行变化" desc={`当前记录包含 ${samples.length} 个记录点；${step > 1 ? `每 ${step} 点显示一点，原始数据完整保留` : '显示全部记录点'}。纵轴为原始记录值。`}>
        <div className="mb-4 flex flex-wrap gap-3">
          <label className="text-xs text-muted">站点 <select aria-label="站点" value={selectedSite} onChange={(e) => { setSite(e.target.value); setRun(0) }} className="rounded border border-edge bg-panel2 p-2 text-slate-900">{sites.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="text-xs text-muted">记录 <select aria-label="记录" value={run < traces.length ? run : 0} onChange={(e) => setRun(Number(e.target.value))} className="rounded border border-edge bg-panel2 p-2 text-slate-900">{traces.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
        </div>
        <TraceChart data={plotted} name="记录值" xLabel="记录顺序" />
      </Panel>
      {data.confusion && <Panel className="mt-4" title={simple ? '每个网站被识别的情况' : '测试集混淆矩阵'}><ConfusionMatrix labels={data.confusion.labels} matrix={data.confusion.matrix} /></Panel>}
      {!data.confusion && <p className="mt-3 text-xs text-muted">{simple ? '没有提供逐次猜测的结果，因此不展示每个网站被猜成其他网站的统计。' : '混淆矩阵未提供。仅凭原始 trace 或汇总准确率不能还原逐样本预测结果。'}</p>}
    </div>
  )
}
