import { useState, useRef, useEffect } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { validateChannelResult, channelStats } from '../lib/channel.js'
import { downloadJSON, downloadMarkdown } from '../lib/report.js'

export default function ChannelExperiment({ facts, conn, jobs, setJobs, result, setResult, health, busy, jobSubmitting, setJobSubmitting, professional, autoRun }) {
  const [bits, setBits] = useState('')
  const [dedicatedConfirmed, setDedicatedConfirmed] = useState(false)
  const submitting = jobSubmitting
  const setSubmitting = setJobSubmitting
  const mounted = useRef(true)
  const importGeneration = useRef(0)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; importGeneration.current++ } }, [])
  const [error, setError] = useState('')
  const prevTarget = useRef('')

  const targetKey = JSON.stringify([conn?.host?.trim(), conn?.port?.trim() || '22', conn?.user?.trim(), conn?.auth])
  useEffect(() => {
    if (prevTarget.current && prevTarget.current !== targetKey) setDedicatedConfirmed(false)
    prevTarget.current = targetKey
  }, [targetKey])

  useEffect(() => {
    if (busy) setDedicatedConfirmed(false)
  }, [busy])

  const platformReady = facts?.KERNEL?.startsWith('Linux') && facts.ARCH === 'x86_64' && facts.VENDOR === 'GenuineIntel' && facts.PYTHON3 === 'present' && facts.TEMPERATURE === 'present'
  const validBits = /^[01]{1,8}$/.test(bits)
  const canStart = !busy && !submitting && platformReady && facts?.HOSTKEY && conn?.authorized && validBits && dedicatedConfirmed && health?.channelEnabled === true

  async function start() {
    if (!canStart) return
    const submittedHost = conn.host.trim()
    setSubmitting(true); setError('')
    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: conn.host.trim(), port: conn.port.trim() || '22', user: conn.user.trim(),
          authType: conn.auth, password: conn.auth === 'password' ? conn.secret : '', privateKey: conn.auth === 'key' ? conn.secret : '',
          hostKeyFingerprint: facts.HOSTKEY, experiment: 'channel', bits, authorized: conn.authorized, dedicatedHostConfirmed: true,
        }),
      })
      const data = await response.json()
      if (!response.ok || !/^[a-f0-9]{48}$/.test(data.id)) throw new Error(data.error || '未能创建收发实验任务')
      setJobs((current) => ({ ...current, E1: { id: data.id, state: 'connecting', host: submittedHost, experiment: 'channel' } }))
      if (mounted.current) setDedicatedConfirmed(false)
    } catch (e) { if (mounted.current) setError(e.message) } finally { setSubmitting(false) }
  }

  async function importResult(event) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    const generation = ++importGeneration.current
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('文件不能超过 4 MiB。')
      const record = JSON.parse(await file.text())
      const checked = validateChannelResult(record)
      if (checked.error) throw new Error(checked.error)
      if (!mounted.current || generation !== importGeneration.current) return
      setResult((current) => ({ ...current, channel: record, channelFile: file.name, channelJobId: null, timestamp: new Date().toISOString() }))
      setError('')
    } catch (e) { if (mounted.current && generation === importGeneration.current) setError(e.message || '未能读取实验结果') }
  }

  const channelJob = jobs.E1?.experiment === 'channel' ? jobs.E1 : null
  async function stop() {
    const id = channelJob?.id
    if (!id) return
    try {
      const response = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('停止请求未完成，请重试')
      setJobs((current) => current.E1?.id === id ? { ...current, E1: { ...current.E1, state: 'cancelling', message: '正在停止收发进程' } } : current)
    } catch (e) { if (mounted.current) setError(e.message) }
  }
  const channelRecord = result?.channel
  const stats = channelRecord ? channelStats(channelRecord) : null

  function downloadResult() {
    if (!channelRecord) return
    downloadJSON(channelRecord, 'channel-result.json')
  }

  function downloadReport() {
    if (!channelRecord || !stats) return
    const lines = ['# ThermalScope 热信号收发实验报告', '', `- 生成时间: ${new Date().toISOString()}`]
    lines.push(`- 发送位: ${channelRecord.sentBits}`)
    lines.push(`- 接收位: ${channelRecord.receivedBits}`)
    lines.push(`- 状态: ${channelRecord.status}`)
    lines.push(`- 原因: ${channelRecord.reason}`)
    lines.push('')
    lines.push('## 统计')
    lines.push(`- 总位数: ${stats.total}`)
    lines.push(`- 解码位: ${stats.decoded}`)
    lines.push(`- 未知位: ${stats.unknown}`)
    lines.push(`- 正确位: ${stats.correct}`)
    lines.push(`- 错误位: ${stats.incorrect}`)
    lines.push(`- 全部发送位中接对的比例: ${stats.ratio.toFixed(2)}%`)
    lines.push('')
    lines.push('## 约束')
    lines.push('- 本实验为独立温度教学实验，不是 TRM 论文复现。')
    lines.push('- 需要专用 Intel Linux 机器和可读 CPU package 传感器。')
    lines.push('- 演示不等于隔离绕过证据，不声称成功建立隐蔽信道。')
    lines.push('- 阈值仅由已知前导确定，接收端从未收到载荷本身。')
    downloadMarkdown(lines.join('\n'), 'channel-experiment-report.md')
  }

  let disableReason = ''
  if (busy || submitting) disableReason = '当前有任务正在提交或进行中'
  else if (health?.channelEnabled !== true) disableReason = '此部署尚未开启主动收发；仍可导入已有实验结果'
  else if (!facts) disableReason = '请先连接实验机'
  else if (!platformReady) disableReason = '需要 Intel x86_64 Linux、Python 3 和可读温度来源；开始前还会核对封装温度和核心条件'
  else if (!conn?.authorized) disableReason = '请先确认连接授权'
  else if (professional && !validBits) disableReason = '请输入 1–8 位二进制序列'
  else if (professional && !dedicatedConfirmed) disableReason = '请确认这是专用实验机'
  else if (busy) disableReason = '当前有任务进行中'

  const autoRunMessage = autoRun?.message
  const autoRunState = autoRun?.state || 'idle'
  const showAutoRunAlert = autoRunState === 'blocked' || autoRunState === 'failed'

  return <section className="channel-experiment">
    <div className="auto-run-panel">
      <div className="auto-run-heading">
        <h2>{professional ? '发送什么？' : '自动发送与接收'}</h2>
        <p>{professional ? '输入一串 0 和 1，让发送程序交替计算和休息。接收程序只看温度变化，尝试读出同样的内容。最后逐位对照，看这次传对了多少。' : '应用会自动准备一组测试内容；发送程序交替计算和休息，接收程序根据温度尝试还原。'}</p>
      </div>
      {professional && <>
        <div style={{ marginTop: 16 }}>
          <label className="form-label">
            <span>发送位序列（最多 8 位）</span>
            <input className="form-input" value={bits} onChange={(e) => setBits(e.target.value.slice(0, 8))} placeholder="0101" maxLength={8} style={{ maxWidth: 200 }} />
          </label>
          <p className="field-hint">已知前导 0101，每时隙 6 秒，总时长约 {(4 + (bits.length || 0)) * 6 + 1} 秒（&lt;80 秒）。发送端最多占用一个核心约 50% 负载，达到 80°C 或读取失败自动停止，不强制降频。</p>
        </div>
        <label className="authorization-check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={dedicatedConfirmed} onChange={(e) => setDedicatedConfirmed(e.target.checked)} />
          <span>我已确认这台机器可用于实验，允许本次短时 CPU 计算负载</span>
        </label>
        <div className="auto-run-actions">
          <button className="primary-button" onClick={start} disabled={!canStart}>
            {submitting ? '正在提交…' : '开始收发实验'}
          </button>
          {disableReason && <span className="field-hint">{disableReason}</span>}
        </div>
      </>}
      {!professional && <>
        {autoRunMessage && <p role={showAutoRunAlert ? 'alert' : undefined} className={showAutoRunAlert ? 'form-error' : 'field-hint'} style={{ marginTop: 12 }}>{autoRunMessage}</p>}
        {!channelJob && autoRunState === 'idle' && <p className="field-hint" style={{ marginTop: 12 }}>连接实验机后会自动开始。</p>}
        <p className="field-hint" style={{ marginTop: 8 }}>自动生成 8 位测试内容，约 73 秒完成，可随时停止；信号不足时会如实显示无法接收。</p>
      </>}
      {channelJob && <div className="job-progress" aria-live="polite"><p>{channelJob.message || '正在连接实验机'}</p>{channelJob.connectionError && <p className="form-error">{channelJob.connectionError}，正在重试。</p>}<details><summary>查看运行记录</summary><pre>{channelJob.log || '等待记录…'}</pre></details></div>}
      {channelJob && !['completed', 'failed', 'cancelled', 'interrupted'].includes(channelJob.state) && <div className="auto-run-actions"><button className="secondary-button" onClick={stop} disabled={channelJob.state === 'cancelling'}>停止本次收发</button></div>}
      {error && <p role="alert" className="form-error" style={{ marginTop: 12 }}>{error}</p>}
    </div>

    <section className="import-section">
      <h3>已有记录？直接查看</h3>
      <div className="card">
        <label className="form-label">
          <span>选择 channel-result.json</span>
          <input type="file" accept=".json" onChange={importResult} disabled={Boolean(busy || submitting)} />
        </label>
        <p className="field-hint">选择本应用保存的实验结果（不超过 4 MiB）。</p>
      </div>
    </section>

    {channelRecord && stats && <>
      <p className="field-hint">{result.channelFile ? `正在查看导入文件：${result.channelFile}` : `正在查看 ${channelRecord.startedAt} 的收发结果`}{busy ? '；本次实验仍在进行，下面保留的是此前结果。' : ''}</p>
      <div className="stat-grid">
        <div className="stat-card"><strong>{stats.total}</strong><span>总位数</span></div>
        <div className="stat-card"><strong>{stats.decoded}</strong><span>解码位</span></div>
        <div className="stat-card"><strong>{stats.unknown}</strong><span>未知位</span></div>
        <div className="stat-card"><strong>{stats.correct}</strong><span>正确位</span></div>
        <div className="stat-card"><strong>{stats.incorrect}</strong><span>错误位</span></div>
        <div className="stat-card"><strong>{stats.ratio.toFixed(2)}%</strong><span>全部发送位中接对的比例</span></div>
      </div>

      {channelRecord.status === 'inconclusive' && <p className="form-error" role="alert">这次未能可靠接收：{channelRecord.reason}{!channelRecord.calibration.valid && channelRecord.calibration.separationC !== null && `。校准时，发送 1 比发送 0 平均高 ${channelRecord.calibration.separationC.toFixed(2)}°C；需要至少 0.50°C，且两组校准记录不重叠。`}</p>}

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>发送与接收对照</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', alignItems: 'center', fontFamily: 'monospace', fontSize: 13 }}>
          <span className="field-hint">发送</span>
          <div className="bitmap-row">{Array.from(channelRecord.sentBits).map((bit, i) => {
            const r = channelRecord.receivedBits[i]
            const wrong = r !== '?' && r !== bit
            return <span key={i} className={`bit ${bit === '1' ? 'bit-one' : ''} ${wrong ? 'bit-different' : ''}`}>{bit}</span>
          })}</div>
          <span className="field-hint">接收</span>
          <div className="bitmap-row">{Array.from(channelRecord.receivedBits).map((bit, i) => {
            const s = channelRecord.sentBits[i]
            const wrong = bit !== '?' && bit !== s
            const unknown = bit === '?'
            return <span key={i} className={`bit ${bit === '1' ? 'bit-one' : ''} ${wrong ? 'bit-different' : ''}`} style={unknown ? { background: '#f0f1f4', color: '#98a2b3' } : undefined}>{bit}</span>
          })}</div>
        </div>
      </div>

      {channelRecord.samples.length > 0 && <div className="chart-container">
        <h3>接收端看到的温度<span className="field-hint"> · °C</span></h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={channelRecord.samples}>
            <CartesianGrid stroke="#edf0f3" strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, 'dataMax']} tickFormatter={(value) => Math.round(value)} dataKey="seconds" tick={{ fontSize: 11 }} label={{ value: '经过时间 / 秒', position: 'insideBottomRight', offset: -4, fontSize: 10 }} />
            <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip />
            <ReferenceLine x={24} stroke="#7894a8" label={{ value: '开始传内容', position: 'insideTopLeft', fontSize: 10 }} />
            {channelRecord.calibration?.threshold != null && <ReferenceLine y={channelRecord.calibration.threshold} stroke="#ff6a00" strokeDasharray="6 3" label={{ value: '阈值', position: 'right', fontSize: 10, fill: '#ff6a00' }} />}
            <Line dataKey="temperatureC" name="CPU 温度" stroke="#ea680b" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <p className="field-hint">
          校准阶段 {channelRecord.slots.filter((s) => s.phase === 'calibration').length} 个时隙，内容传输阶段 {channelRecord.slots.filter((s) => s.phase === 'payload').length} 个时隙。
          {channelRecord.calibration?.valid ? ` 校准均值 0=${channelRecord.calibration.zeroMean?.toFixed(2)}°C 1=${channelRecord.calibration.oneMean?.toFixed(2)}°C，间隔 ${channelRecord.calibration.separationC?.toFixed(2)}°C。` : ' 校准无效，接收位均为 ?。'}
        </p>
      </div>}

      <details className="card source-details">
        <summary>实验参数与详情</summary>
        <dl>
          <div><dt>发送 CPU</dt><dd>{channelRecord.senderCPU}</dd></div>
          <div><dt>接收 CPU</dt><dd>{channelRecord.receiverCPU}</dd></div>
          <div><dt>传感器</dt><dd>{channelRecord.signal.label} ({channelRecord.signal.path})</dd></div>
          <div><dt>前导</dt><dd>{channelRecord.preamble}</dd></div>
          <div><dt>时隙</dt><dd>{channelRecord.slotSeconds} 秒</dd></div>
          <div><dt>状态</dt><dd>{channelRecord.status} — {channelRecord.reason}</dd></div>
          <div><dt>时长</dt><dd>{channelRecord.durationSeconds} 秒</dd></div>
        </dl>
        {channelRecord.notes?.length > 0 && <ul style={{ marginTop: 12, paddingLeft: 20, fontSize: 12, color: '#667085' }}>{channelRecord.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      </details>

      <div className="result-actions">
        <button className="secondary-button" onClick={downloadResult}>保存实验数据</button>
        <button className="secondary-button" onClick={downloadReport}>下载分析报告</button>
        {result.channelJobId && <a className="secondary-button" href={`?job=${result.channelJobId}`}>重新打开本次结果</a>}
      </div>

      <p className="field-hint" style={{ marginTop: 16 }}>
        本实验为独立的温度教学实验，不是 TRM 论文复现。双方事先约定了开始时间和每位时长；接收端用前 4 位已知信号确定阈值，之后只根据温度判断。
      </p>
    </>}

    {!channelRecord && !result?.thermal && <div className="project-empty"><h3>还没有实验结果</h3><p>连接实验机开始收发实验，或导入已有的 channel-result.json。</p></div>}
  </section>
}
