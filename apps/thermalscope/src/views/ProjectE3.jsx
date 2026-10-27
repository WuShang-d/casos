import { useEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { parseMapCountFile, computeDistributionStats, buildComparisonHistogram } from '../lib/locationAnalysis.js'
import { generateMarkdownReport, downloadJSON, downloadMarkdown } from '../lib/report.js'

export default function ProjectE3({ result, setResult, professional }) {
  const [error, setError] = useState('')
  const generation = useRef({ map: 0, unmap: 0 })
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const mapped = result?.map, unmapped = result?.unmap
  const chart = mapped && unmapped ? buildComparisonHistogram(mapped.values, unmapped.values) : null
  async function importFile(event, kind) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    const request = ++generation.current[kind]
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('单个测量文件不能超过 2 MiB。')
      const checked = parseMapCountFile(await file.text())
      if (checked.error) throw new Error(checked.error)
      if (!mounted.current || request !== generation.current[kind]) return
      setResult((current) => ({ ...current, [kind]: { values: checked.values, stats: computeDistributionStats(checked.values), file: file.name }, timestamp: new Date().toISOString() })); setError('')
    } catch (e) { if (mounted.current && request === generation.current[kind]) setError(e.message) }
  }
  function report() {
    const summary = [], missing = []
    for (const [kind, label] of [['map', 'map-count'], ['unmap', 'unmap-count']]) {
      const group = result[kind]
      if (group) summary.push(`${label}：${group.stats.count} 条，中位数 ${group.stats.median}，范围 ${group.stats.min}–${group.stats.max}`)
      else missing.push(`缺少 ${label}，尚不能比较两组`)
    }
    if (mapped && unmapped) summary.push(`两组中位数差（map − unmap）：${mapped.stats.median - unmapped.stats.median}`, mapped.values.length === unmapped.values.length ? '两组数量相同' : '两组数量不同，分别统计，未补齐缺失值')
    downloadMarkdown(generateMarkdownReport('两组测量数据比较', { source: [mapped?.file, unmapped?.file].filter(Boolean).join('、'), inputCount: `${mapped?.values.length || 0} / ${unmapped?.values.length || 0}`, summary, missing, limitations: ['比较的只是给定两类位置的原始测量值分布，差异不等于恢复了系统真实地址。', '上游实验是固定位置的 mapped/unmapped 重复测量，不是 512 个候选位置的搜索。'] }), 'location-analysis-report.md')
  }
  return <section>
    <div className="project-header"><div><h1>比较两组测量数据</h1><p>导入两份实验测量文件，把两组数值画在一张图里，看它们差多少、各自集中在哪个范围。</p></div></div>
    <div className="form-row import-section">{[['map', 'map-count', '第一组测量'], ['unmap', 'unmap-count', '第二组测量']].map(([kind, file, title]) => <div className="card" key={kind}><h3>{title}</h3><label className="form-label"><span>选择 {file}</span><input type="file" onChange={(e) => importFile(e, kind)} /></label><p className="field-hint">每行一个非负整数，保留原始测量单位。</p></div>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {(mapped || unmapped) ? <><div className="stat-grid">{[[mapped, '第一组'], [unmapped, '第二组']].map(([group, label]) => group && <div className="stat-card" key={label}><strong>{group.stats.median}</strong><span>{label}中位数 · {group.stats.count} 条记录</span></div>)}{mapped && unmapped && <div className="stat-card"><strong>{mapped.stats.median - unmapped.stats.median}</strong><span>中位数差 · 第一组减第二组</span></div>}</div>{chart ? <div className="chart-container"><h3>两组测量分布</h3><p className="field-hint">使用相同的取值区间；橙色为第一组，灰蓝色为第二组。</p><ResponsiveContainer width="100%" height={290}><BarChart data={chart}><CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" /><XAxis dataKey="range" tick={{ fontSize: 10 }} /><YAxis allowDecimals={false} tick={{ fontSize: 11 }} /><Tooltip /><Bar dataKey="map" name="第一组 · 条数" fill="#ed7419" isAnimationActive={false} /><Bar dataKey="unmap" name="第二组 · 条数" fill="#7894a8" isAnimationActive={false} /></BarChart></ResponsiveContainer>{mapped.values.length !== unmapped.values.length && <p className="field-hint">两组记录数量不同，图中保留各自的实际条数，没有补齐或按位置配对。</p>}</div> : <p className="field-hint">再导入另一组记录，就可以比较两组分布。</p>}<p className="field-hint">测量差异只说明这两份记录的数值分布不同，不能单独证明系统位置已经被猜中。</p></> : <div className="project-empty"><h3>还没有测量记录</h3><p>导入 map-count 与 unmap-count 后，这里会展示数量、中位数和分布。</p></div>}
    {professional && <details className="card source-details"><summary>实验来源与完整测量数据</summary><p>上游 break-KASLR.c 在两个固定位置之间重复测量，输出 map-count 与 unmap-count；完整循环较长且包含固定处理器与传感器路径。本应用分析已有文件，不将统计差异称为地址恢复成功。</p><div className="table-scroll"><table className="confusion-table"><thead><tr><th>记录编号</th><th>map-count</th><th>unmap-count</th></tr></thead><tbody>{Array.from({ length: Math.min(200, Math.max(mapped?.values.length || 0, unmapped?.values.length || 0)) }, (_, index) => <tr key={index}><td>{index + 1}</td><td>{mapped?.values[index] ?? '—'}</td><td>{unmapped?.values[index] ?? '—'}</td></tr>)}</tbody></table></div><p className="field-hint">表格最多显示前 200 条，保存数据保留全部记录。</p></details>}
    {result && <div className="result-actions"><button className="secondary-button" onClick={() => downloadJSON(result, 'location-analysis.json')}>保存分析数据</button><button className="secondary-button" onClick={report}>下载分析报告</button></div>}
  </section>
}
