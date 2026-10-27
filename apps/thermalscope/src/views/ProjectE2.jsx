import { useEffect, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { validateModelTraces, computeConfusionMatrix, parsePredictionsJSON } from '../lib/modelAnalysis.js'
import { parseModelPickles } from '../lib/pickle.js'
import { generateMarkdownReport, downloadJSON, downloadMarkdown } from '../lib/report.js'

export default function ProjectE2({ result, setResult, professional }) {
  const [error, setError] = useState('')
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const generation = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++ } }, [])
  const traces = result?.traces || []
  const confusion = result?.confusion
  const selected = traces[Math.min(index, traces.length - 1)]
  async function importTraces(event) {
    const files = Array.from(event.target.files || []); event.target.value = ''
    if (!files.length) return
    const request = ++generation.current; setLoading(true)
    try {
      if (files.length > 64 || files.some((f) => f.size > 32 * 1024 * 1024) || files.reduce((n, f) => n + f.size, 0) > 64 * 1024 * 1024) throw new Error('最多选择 64 个文件，每个不超过 32 MiB，总大小不超过 64 MiB。')
      const imported = []
      for (const file of files) {
        let parsed
        if (/\.pkl$/i.test(file.name)) parsed = parseModelPickles(await file.arrayBuffer())
        else if (/\.json$/i.test(file.name)) parsed = validateModelTraces(JSON.parse(await file.text()).traces)
        else throw new Error('请选择 .pkl 或包含 traces 数组的 .json 文件。')
        if (parsed.error) throw new Error(`${file.name}：${parsed.error}`)
        imported.push(...parsed.traces)
      }
      const checked = validateModelTraces(imported)
      if (checked.error) throw new Error(checked.error)
      if (!mounted.current || request !== generation.current) return
      setResult({ traces: checked.traces, files: files.map((f) => f.name), timestamp: new Date().toISOString() }); setIndex(0); setError('')
    } catch (e) { if (mounted.current && request === generation.current) setError(e.message) } finally { if (mounted.current && request === generation.current) setLoading(false) }
  }
  async function importPredictions(event) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    const request = ++generation.current
    try {
      if (!traces.length) throw new Error('请先导入模型记录，再添加对应的识别结果。')
      if (file.size > 32 * 1024 * 1024) throw new Error('识别结果不能超过 32 MiB。')
      const checked = parsePredictionsJSON(await file.text())
      if (checked.error) throw new Error(checked.error)
      const stats = computeConfusionMatrix(checked.predictions)
      if (!stats) throw new Error('识别结果中没有可用记录。')
      if (!mounted.current || request !== generation.current) return
      setResult((current) => ({ ...current, predictions: checked.predictions, predictionFile: file.name, confusion: stats })); setError('')
    } catch (e) { if (mounted.current && request === generation.current) setError(e.message) }
  }
  function report() {
    downloadMarkdown(generateMarkdownReport('模型识别结果查看', { source: [...(result.files || []), result.predictionFile].filter(Boolean).join('、'), inputCount: `${traces.length} 条记录，${new Set(traces.map((t) => t.label)).size} 个模型标签`, summary: confusion ? [`预测记录 ${confusion.total} 条，其中 ${confusion.correct} 条标签相同，准确率 ${confusion.accuracy.toFixed(2)}%`] : ['尚未提供预测标签，仅展示原始记录'], missing: confusion ? [] : ['未提供 predictions.json，准确率和混淆矩阵不可得'], limitations: ['准确率只统计提供的预测记录，不由曲线直接推断。', '记录的数值保留上游原始单位，不当作摄氏温度或统一时间刻度。', '本应用未执行原论文的完整模型采集与训练流程。'] }), 'model-analysis-report.md')
  }
  return <section>
    <div className="project-header"><div><h1>查看模型识别结果</h1><p>导入已有的模型运行记录，查看每个模型的曲线；再添加识别结果，核对认对了多少、哪些模型容易认错。</p></div></div>
    <div className="card import-section"><h3>导入模型记录</h3><label className="form-label"><span>选择一份或多份带模型标签的记录</span><input type="file" multiple accept=".pkl,.json" onChange={importTraces} disabled={loading} /></label><p className="field-hint">支持研究工具保存的 .pkl 文件，或带标签的 JSON 记录。{loading ? '正在检查文件…' : '更换记录后，可重新添加对应的预测标签。'}</p></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {traces.length > 0 ? <><div className="stat-grid"><div className="stat-card"><strong>{traces.length}</strong><span>记录条数</span></div><div className="stat-card"><strong>{new Set(traces.map((t) => t.label)).size}</strong><span>模型标签</span></div><div className="stat-card"><strong>{confusion ? `${confusion.accuracy.toFixed(2)}%` : '—'}</strong><span>{confusion ? '识别结果正确率' : '尚未提供预测标签'}</span></div></div><div className="chart-container"><h3>模型运行记录</h3><div className="auto-run-actions"><label className="form-label">查看第几条记录<input type="number" className="form-input" min={1} max={traces.length} value={Math.min(index + 1, traces.length)} onChange={(e) => setIndex(Math.max(0, Math.min(traces.length - 1, Number(e.target.value || 1) - 1)))} /></label><span className="field-hint">{selected.label} · {selected.samples.length} 个记录点</span></div><ResponsiveContainer width="100%" height={280}><LineChart data={selected.samples.slice(0, 1000).map((value, point) => ({ point, value }))}><CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" /><XAxis dataKey="point" tick={{ fontSize: 11 }} label={{ value: '记录点', position: 'insideBottomRight', offset: -4, fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Line dataKey="value" name={`${selected.label} · 原始采样值`} stroke="#ed7419" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer><p className="field-hint">保留原始采样单位；{selected.samples.length > 1000 ? '图中显示前 1000 点，下载数据包含全部记录。' : '横轴表示记录点顺序。'}</p></div><div className="card import-section"><h3>添加已有识别结果（可选）</h3><label className="form-label"><span>选择 predictions.json</span><input type="file" accept=".json" onChange={importPredictions} /></label><p className="field-hint">已有真实标签和预测标签时才计算准确率；曲线本身不代表识别成功。</p></div></> : <div className="project-empty"><h3>还没有模型记录</h3><p>导入已有记录后，这里会显示标签、原始曲线和记录数量。</p></div>}
    {confusion && <div className="card"><h3>哪些模型容易被混淆</h3><p className="field-hint">行表示真实标签，列表示预测标签；每格为提供的预测记录数。仅统计你提供的预测文件。</p><div className="table-scroll"><table className="confusion-table"><thead><tr><th>真实 / 预测</th>{confusion.labels.map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{confusion.labels.map((actual) => <tr key={actual}><th>{actual}</th>{confusion.labels.map((predicted) => { const count = confusion.matrix[actual][predicted]; return <td key={predicted} style={{ backgroundColor: count ? `rgba(255,106,0,${Math.min(.65, .08 + count / confusion.total)})` : undefined }}>{count}</td> })}</tr>)}</tbody></table></div></div>}
    {professional && <details className="card source-details"><summary>数据格式与运行范围</summary><p>上游记录采用连续的 (trace, label) pickle 数据；此处只解析数值和标签。上游采集脚本依赖未附带的 full3.so 与本机路径，本版支持已有记录分析，不提供该模型采集流程的自动执行。</p><p>JSON 记录：{'{ "traces": [{ "label": "模型名", "samples": [数值, ...] }] }'}</p><p>识别结果：{'{ "predictions": [{ "actual": "真实标签", "predicted": "预测标签" }] }'}</p></details>}
    {result && <div className="result-actions"><button className="secondary-button" onClick={() => downloadJSON(result, 'model-analysis.json')}>保存分析数据</button><button className="secondary-button" onClick={report}>下载分析报告</button></div>}
  </section>
}
