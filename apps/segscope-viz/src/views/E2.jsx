import { Kpi, Panel, Provenance, SectionTitle } from '../components/ui.jsx'
import { ErrorRateChart } from '../components/charts.jsx'
import { e2 } from '../lib/data.js'

export default function E2({ rows: propRows, simple = false }) {
  const uploaded = !!(propRows && propRows.length)
  const rows = uploaded ? propRows : e2.rows
  const pick = rows.find((r) => r.timeout === 100000) || rows[Math.floor(rows.length / 2)]
  const headline = { before: pick.before, after: pick.after }
  const drop = headline.before > 0 ? (((headline.before - headline.after) / headline.before) * 100).toFixed(1) : '—'
  return (
    <div>
      <SectionTitle eyebrow={simple ? undefined : 'E2 · Enhancing Spectral'} title={simple ? '信息传递检查结果' : '增强 Spectral 攻击'}>
        {simple ? '比较每组实验设置下，去除干扰前后的传递出错比例。结果按导入记录显示。' : '对比不同 umwait 超时下过滤前后的误码率，判断本次实验中去除中断干扰的效果。'}
      </SectionTitle>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="去除干扰前出错比例" value={headline.before} unit="%" sub="原始记录" tone="bad" />
        <Kpi label="去除干扰后出错比例" value={headline.after} unit="%" sub="去除干扰后" tone="good" />
        <Kpi label="相对降幅" value={drop} unit="%" sub={headline.before > 0 ? `${simple ? '实验设置' : 'timeout'} = ${pick.timeout}` : '原始误码率为 0，降幅无定义'} tone="accent" />
        <Kpi label="实验设置数量" value={rows.length} sub={uploaded ? '来自上传的 log.csv' : 'umwait 超时扫描'} tone="accent2" />
      </div>

      <Panel className="mt-4" title="去除干扰前后的出错比例"
        desc={uploaded ? '来自你上传的 log.csv' : 'umwait 超时 93000–105000 的逐点对比'}
        right={uploaded ? <span className="chip">导入记录</span> : <Provenance kind={e2.provenance} />}>
        <ErrorRateChart rows={rows} simple={simple} />
      </Panel>

      <Panel className="mt-4" title="原始检查记录" desc="保留每组设置对应的结果">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead className="text-xs uppercase text-muted">
              <tr className="border-b border-edge">
                <th className="py-2 pr-4">{simple ? '实验设置' : 'timeout'}</th>
                <th className="py-2 pr-4">{simple ? '原始出错比例 %' : '原始误码率 %'}</th>
                <th className="py-2 pr-4">{simple ? '传递速度' : 'speed'}</th>
                <th className="py-2 pr-4">{simple ? '有效传递能力' : 'capacity'}</th>
                <th className="py-2 pr-4">{simple ? '干扰次数' : 'irq'}</th>
                <th className="py-2 pr-4 text-good">去除干扰后 %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.timeout}-${i}`} className="border-b border-edge/40">
                  <td className="py-1.5 pr-4">{r.timeout}</td>
                  <td className="py-1.5 pr-4 text-bad">{r.before.toFixed(3)}</td>
                  <td className="py-1.5 pr-4 text-muted">{r.speed}</td>
                  <td className="py-1.5 pr-4 text-muted">{r.capacity}</td>
                  <td className="py-1.5 pr-4 text-muted">{r.irq}</td>
                  <td className="py-1.5 pr-4 text-good">{r.after.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  )
}
