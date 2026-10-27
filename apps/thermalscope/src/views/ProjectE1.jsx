import { useEffect, useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { computeErrorRate, normalizeBitString, validateThermalRecord, buildThermalCharts } from '../lib/thermal.js'
import { computeReadiness } from '../lib/readiness.js'
import { generateMarkdownReport, downloadJSON, downloadMarkdown } from '../lib/report.js'
import ChannelExperiment from './ChannelExperiment.jsx'

const terminal = (state) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(state)
const states = { connecting: '正在连接', uploading: '正在传送脚本', preparing: '正在准备', running: '正在记录', transmitting: '正在发送与接收', collecting: '正在取回记录', cancelling: '正在停止', cancelled: '已停止', completed: '记录完成', failed: '未能完成', interrupted: '服务重启，任务已中断' }
const colors = ['#ea680b', '#3277af', '#2c9173', '#916fc0', '#c68b37', '#718096']
const historyKey = 'thermalscope-recording-history'
function readHistory() { try { const value = JSON.parse(sessionStorage.getItem(historyKey) || '[]'); return Array.isArray(value) ? value.filter((j) => j && /^[a-f0-9]{48}$/.test(j.id)).slice(0, 20) : [] } catch { return [] } }

export default function ProjectE1({ facts, jobs, setJobs, result, setResult, conn, professional, health, jobSubmitting, setJobSubmitting, autoRun }) {
  const [sent, setSent] = useState(result?.bits?.sent || '')
  const [received, setReceived] = useState(result?.bits?.received || '')
  const [error, setError] = useState('')
  const submitting = jobSubmitting
  const setSubmitting = setJobSubmitting
  const [page, setPage] = useState(0)
  const [history, setHistory] = useState(readHistory)
  const job = jobs.E1
  const busy = job && !terminal(job.state)
  const passiveBusy = busy && job?.experiment !== 'channel'
  const ready = computeReadiness(facts).canStart
  const thermal = result?.thermal
  const charts = useMemo(() => thermal ? buildThermalCharts(thermal) : null, [thermal])
  const bits = result?.bits
  useEffect(() => {
    if (!job?.id) return
    setHistory((current) => {
      const entry = { id: job.id, state: job.state, host: job.host, createdAt: job.createdAt, experiment: job.experiment }
      const next = [entry, ...current.filter((j) => j.id !== job.id)].slice(0, 20)
      try { sessionStorage.setItem(historyKey, JSON.stringify(next)) } catch {}
      return next
    })
  }, [job?.id, job?.state, job?.host, job?.createdAt, job?.experiment])

  function compare(nextSent = sent, nextReceived = received, files = []) {
    try {
      const stats = computeErrorRate(nextSent, nextReceived)
      if (stats.error) throw new Error(stats.error)
      setResult((current) => ({ ...current, bits: { sent: normalizeBitString(nextSent), received: normalizeBitString(nextReceived), stats, files }, timestamp: new Date().toISOString() }))
      setPage(0); setError('')
    } catch (e) { setError(e.message) }
  }
  async function importBits(event) {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    try {
      if (files.length !== 2 || files.some((f) => f.size > 16 * 1024)) throw new Error('请同时选择 send_signal 和 receive_signal，单文件不超过 16 KiB。')
      const send = files.find((f) => /^send_signal(?:\.txt)?$/.test(f.name))
      const receive = files.find((f) => /^receive_signal(?:\.txt)?$/.test(f.name))
      if (!send || !receive) throw new Error('需要文件名为 send_signal 和 receive_signal 的两份记录。')
      const [a, b] = await Promise.all([send.text(), receive.text()])
      const stats = computeErrorRate(a, b)
      if (stats.error) throw new Error(stats.error)
      setSent(normalizeBitString(a)); setReceived(normalizeBitString(b)); compare(a, b, files.map((f) => f.name))
    } catch (e) { setError(e.message) }
  }
  async function importThermal(event) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('热活动记录不能超过 4 MiB。')
      const record = JSON.parse(await file.text())
      const checked = validateThermalRecord(record)
      if (checked.error) throw new Error(checked.error)
      setResult((current) => ({ ...current, thermal: record, thermalFile: file.name, thermalJobId: null, timestamp: new Date().toISOString() })); setError('')
    } catch (e) { setError(e.message || '未能读取热活动记录') }
  }
  async function startPassive() {
    if (!ready || !facts?.HOSTKEY || !conn.authorized || busy || submitting) { setError('请先连接电脑并确认记录条件。'); return }
    setSubmitting(true); setError('')
    try {
      const response = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ host: conn.host.trim(), port: conn.port.trim() || '22', user: conn.user.trim(), authType: conn.auth, password: conn.auth === 'password' ? conn.secret : '', privateKey: conn.auth === 'key' ? conn.secret : '', hostKeyFingerprint: facts.HOSTKEY, experiment: 'thermal', authorized: conn.authorized }) })
      const data = await response.json()
      if (!response.ok || !/^[a-f0-9]{48}$/.test(data.id)) throw new Error(data.error || '未能创建记录任务')
      setJobs((current) => ({ ...current, E1: { id: data.id, state: 'connecting', host: conn.host, experiment: 'thermal' } }))
    } catch (e) { setError(e.message) } finally { setSubmitting(false) }
  }
  async function stop() {
    setError('')
    try {
      const response = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('未能停止，请稍后重试')
      setJobs((current) => ({ ...current, E1: { ...current.E1, state: 'cancelling', message: '正在停止本次任务' } }))
    } catch (e) { setError(e.message) }
  }
  async function remove(entry) {
    try {
      const response = await fetch(`/api/jobs/${entry.id}`, { method: 'DELETE' })
      if (!response.ok && response.status !== 404) throw new Error('删除未完成，请稍后重试')
      const next = history.filter((j) => j.id !== entry.id); setHistory(next); sessionStorage.setItem(historyKey, JSON.stringify(next))
      if (job?.id === entry.id) setJobs((current) => ({ ...current, E1: null }))
    } catch (e) { setError(e.message) }
  }
  function report() {
    const summaries = [], missing = []
    if (bits) summaries.push(`发送 ${bits.stats.sentBits} 位，接收 ${bits.stats.receivedBits} 位`, `编辑距离 ${bits.stats.editDistance}，编辑距离比例 ${bits.stats.editRatio.toFixed(2)}%`, bits.stats.mismatchRatio === null ? '序列长度不同，未计算逐位错配率' : `逐位错配率 ${bits.stats.mismatchRatio.toFixed(2)}%`)
    if (thermal) {
      summaries.push(`${thermal.samples.length} 个采样点，${thermal.sources.length} 个来源`, `开始时间：${thermal.startedAt}`, ...thermal.sources.map((s) => `${s.label || s.id}：${s.unit}，来源 ${s.path}`), ...(thermal.notes || []))
      for (const s of thermal.sources) { const n = thermal.samples.filter((p) => p.values[s.id] === null).length; if (n) missing.push(`${s.label || s.id} 有 ${n} 个空值`) }
    }
    const source = [bits?.files?.join('、') || (bits ? '本次输入的位序列' : ''), thermal ? result.thermalFile || '自动采集 thermal-trace.json' : ''].filter(Boolean).join('；')
    downloadMarkdown(generateMarkdownReport('温度记录与内容核对', { source, inputCount: summaries[0], params: thermal ? { durationSeconds: thermal.durationSeconds, intervalSeconds: thermal.intervalSeconds } : undefined, summary: summaries, missing, limitations: ['被动温度记录不等于信道复现；位序列比较只反映所给记录。', '编辑距离比例包含插入和删除，可能超过 100%，不等同于逐位误码率。'] }), 'thermal-activity-report.md')
  }
  return <section>
    <div className="project-header"><div><h1>试试用发热传信息</h1><p>{professional ? '发送一串 0 和 1，看看另一个程序能否从温度变化中读出来。' : '连接实验电脑，应用会自动发送一组测试内容；另一个程序只看温度变化，尝试接收，完成后直接看结果。'}</p></div></div>
    <ChannelExperiment facts={facts} conn={conn} jobs={jobs} setJobs={setJobs} result={result} setResult={setResult} health={health} busy={busy} jobSubmitting={jobSubmitting} setJobSubmitting={setJobSubmitting} professional={professional} autoRun={autoRun} />
    {error && <p role="alert" className="form-error">{error}</p>}
    <details style={{ marginTop: 24 }}>
      <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#4e5969', padding: '12px 0' }}>辅助工具：只记录温度 / 核对已有传输文件</summary>
      <section className="auto-run-panel"><div className="auto-run-heading"><h2>自动记录 60 秒</h2><p>连续记录 60 秒，自动取回并展示图表。只观察电脑现有的温度与计数来源，不额外运行加热任务。</p></div><div className="auto-run-actions">{passiveBusy ? <button className="secondary-button" onClick={stop} disabled={job.state === 'cancelling'}>停止本次任务</button> : <button className="secondary-button" onClick={startPassive} disabled={!ready || submitting || busy}>{submitting ? '正在提交…' : '开始 60 秒记录'}</button>}{!facts && <span className="field-hint">先返回首页连接电脑，已有记录可在下方导入。</span>}{job && job.experiment !== 'channel' && <span className="status-tag">{states[job.state] || '正在检查状态'}</span>}</div>{job && job.experiment !== 'channel' && <div className="job-progress"><p>{job.message}</p>{job.connectionError && <p role="alert" className="form-error">{job.connectionError}，正在重试。</p>}<details><summary>查看运行记录</summary><pre>{job.log || '等待运行记录…'}</pre></details></div>}</section>
      {charts && <section><div className="stat-grid"><div className="stat-card"><strong>{thermal.samples.length}</strong><span>采样点</span></div><div className="stat-card"><strong>{thermal.sources.length}</strong><span>记录来源</span></div><div className="stat-card"><strong>{thermal.durationSeconds} 秒</strong><span>记录时长</span></div></div>{[['temperature', '温度变化（摄氏度）', '°C'], ['trm', '热中断（处理器报告的温度相关事件）', '次 / 采样间隔'], ['throttle', '降频次数（系统节流计数）', '次 / 采样间隔']].map(([kind, title, unit]) => { const sources = thermal.sources.filter((s) => s.kind === kind); if (!sources.length) return null; const data = thermal.samples.map((s) => ({ seconds: s.seconds, ...s.values })); return <div className="chart-container" key={kind}><h3>{title}<span className="field-hint"> · {unit}</span></h3><ResponsiveContainer width="100%" height={250}><LineChart data={data}><CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" /><XAxis dataKey="seconds" tick={{ fontSize: 11 }} label={{ value: '经过时间 / 秒', position: 'insideBottomRight', offset: -4, fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} domain={kind === 'temperature' ? ['auto', 'auto'] : [0, 'auto']} /><Tooltip />{sources.slice(0, 8).map((source, index) => <Line key={source.id} dataKey={source.id} name={source.label || source.id} stroke={colors[index % colors.length]} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />)}</LineChart></ResponsiveContainer>{sources.length > 8 && <p className="field-hint">图中显示前 8 个来源；下载数据保留全部 {sources.length} 个来源。</p>}</div> })}<p className="field-hint">{thermal.notes?.join(' ')} 空值表示未读到数据或计数重新开始，未按零处理。</p>{professional && <details className="card source-details"><summary>采集参数与来源</summary><pre>{JSON.stringify({ startedAt: thermal.startedAt, durationSeconds: thermal.durationSeconds, intervalSeconds: thermal.intervalSeconds, sources: thermal.sources, resets: thermal.resets }, null, 2)}</pre></details>}</section>}
      <section className="import-section"><h3>分析已有记录</h3><div className="card"><label className="form-label"><span>导入本应用保存的热活动记录</span><input type="file" accept=".json" onChange={importThermal} /></label><p className="field-hint">选择 thermal-trace.json，不会覆盖已有的位序列分析。</p></div></section>
      <section className="import-section"><h3>比较发送与接收内容</h3><div className="card"><label className="form-label"><span>选择发送与接收文件</span><input type="file" multiple onChange={importBits} /></label><p className="field-hint">同时选择 send_signal 和 receive_signal。也可以在下面输入；最长 2048 位。</p><div className="form-row" style={{ marginTop: 18 }}><label className="form-label"><span>发送序列</span><textarea className="form-input" rows={3} value={sent} onChange={(e) => setSent(e.target.value)} placeholder="输入 0 和 1 组成的发送记录" /></label><label className="form-label"><span>接收序列</span><textarea className="form-input" rows={3} value={received} onChange={(e) => setReceived(e.target.value)} placeholder="输入对应的接收记录" /></label></div><button className="secondary-button" style={{ marginTop: 16 }} onClick={() => compare()}>比较记录</button></div></section>
      {bits && <section><div className="stat-grid"><div className="stat-card"><strong>{bits.stats.sentBits} / {bits.stats.receivedBits}</strong><span>发送 / 接收位数</span></div><div className="stat-card"><strong>{bits.stats.editRatio.toFixed(2)}%</strong><span>修改多少才能一致（编辑距离比例）</span></div><div className="stat-card"><strong>{bits.stats.mismatchRatio === null ? '—' : `${bits.stats.mismatchRatio.toFixed(2)}%`}</strong><span>相同位置有多少位不同</span></div></div><div className="card"><h3>记录对照</h3><p className="field-hint">{bits.stats.equalLength ? '相同位置的差异以红色边框标出。' : '两组长度不同，按各自记录顺序展示，不代表已经对齐。'}</p>{[['发送', bits.sent], ['接收', bits.received]].map(([label, value]) => <div key={label}><p className="field-hint">{label} · 第 {page * 64 + 1}–{Math.min((page + 1) * 64, value.length)} 位</p><div className="bitmap-row">{Array.from(value.slice(page * 64, (page + 1) * 64)).map((bit, i) => <span className={`bit ${bit === '1' ? 'bit-one' : ''} ${bits.stats.equalLength && bits.sent[page * 64 + i] !== bits.received[page * 64 + i] ? 'bit-different' : ''}`} key={i}>{bit}</span>)}</div></div>)}<button className="text-link" disabled={page === 0} onClick={() => setPage(page - 1)}>上一段</button><button className="text-link" style={{ marginLeft: 20 }} disabled={(page + 1) * 64 >= Math.max(bits.sent.length, bits.received.length)} onClick={() => setPage(page + 1)}>下一段</button></div><p className="field-hint">"修改多少才能一致"统计最少需要添加、删除或替换多少位，再除以发送位数，可能超过 100%；"相同位置有多少位不同"只在两组一样长时计算。</p></section>}
    </details>
    {(thermal || bits) && <div className="result-actions"><button className="secondary-button" onClick={() => downloadJSON(result, 'thermal-analysis.json')}>保存分析数据</button>{thermal && <button className="secondary-button" onClick={() => downloadJSON(thermal, 'thermal-trace.json')}>保存热活动记录</button>}<button className="secondary-button" onClick={report}>下载分析报告</button></div>}
    {history.length > 0 && <details className="card source-details" style={{ marginTop: 24 }}><summary>本浏览器的采集记录（{history.length}）</summary>{history.map((entry) => <div className="history-entry" key={entry.id}><span>{entry.host || '实验电脑'} · {entry.experiment === 'channel' ? '[收发] ' : ''}{states[entry.state] || '待查看'}</span><button className="text-link" disabled={Boolean(busy || submitting)} onClick={() => setJobs((current) => ({ ...current, E1: entry }))}>查看记录</button>{terminal(entry.state) && <button className="text-link" onClick={() => remove(entry)}>删除记录</button>}</div>)}</details>}
  </section>
}
