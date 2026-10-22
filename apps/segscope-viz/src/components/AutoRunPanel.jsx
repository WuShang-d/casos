import { useEffect, useRef, useState } from 'react'
import { importResults } from '../lib/parse.js'

const terminal = (state) => ['completed', 'failed', 'cancelled', 'interrupted'].includes(state)
const stages = ['connecting', 'uploading', 'preparing', 'running', 'collecting', 'completed']
const labels = ['连接电脑', '传送工具', '准备环境', '执行检查', '取回记录', '展示结果']
const notes = {
  E1: '自动建立独立运行环境、准备浏览器，为四个公开网站采集少量记录并生成识别报告。首次准备会下载所需软件；这是轻量检查，不是完整论文实验。',
  E3: '自动编译并执行短时位置测量，返回全部512个候选位置。只给出测量排名，不读取需要额外权限的真实位置。',
  E4: '使用原防护插件比较三种设置下的轻量程序耗时和大小。不会加载系统模块或主动制造中断；这不是完整密码库实验，也不验证防护有效性。',
  E2: '当前执行器尚不支持此项，不会尝试修改处理器设置。',
}

export default function AutoRunPanel({ experiment, conn, facts, jobs, setJobs, results, setResults, onShowResults }) {
  const [polledJob, setJob] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const imported = useRef('')
  const id = jobs[experiment]
  const job = polledJob?.id === id && polledJob?.experiment === experiment ? polledJob : null
  useEffect(() => {
    setJob(null); setError(''); imported.current = ''
    if (!id) return
    let stopped = false, timer
    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${id}`)
        const item = await response.json()
        if (!response.ok) throw new Error(item.error || '无法取得检查进度')
        if (stopped) return
        setJob(item)
        if (item.state === 'completed' && imported.current !== id && results[experiment]?.jobId !== id) {
          const files = await Promise.all(item.files.map(async (file) => {
            const response = await fetch(`/api/jobs/${id}/files/${encodeURIComponent(file.name)}`)
            if (!response.ok) throw new Error('检查记录取回失败，请重试')
            return new File([await response.blob()], file.name)
          }))
          const inputs = files.filter((file) => ['traces.pkl', 'report.txt', 'result-512', 'known_cases_results.tsv'].includes(file.name))
          const data = await importResults(experiment, inputs)
          const metadataFile = files.find((f) => f.name === 'metadata.json')
          const rawMetadata = metadataFile ? JSON.parse(await metadataFile.text()) : {}
          const metadata = { note: typeof rawMetadata.note === 'string' ? rawMetadata.note : undefined }
          const predictions = files.find((f) => f.name === 'predictions.json')
          if (predictions) {
            const confusion = JSON.parse(await predictions.text())
            if (Array.isArray(confusion.labels) && confusion.labels.length <= 100 && confusion.labels.every((s) => typeof s === 'string') && Array.isArray(confusion.matrix) && confusion.matrix.length === confusion.labels.length && confusion.matrix.every((row) => Array.isArray(row) && row.length === confusion.labels.length && row.every((n) => Number.isSafeInteger(n) && n >= 0))) data.confusion = confusion
          }
          if (stopped) return
          imported.current = id
          setResults((current) => ({ ...current, [experiment]: { data, names: inputs.map((f) => f.name), jobId: id, metadata } }))
        }
        if (!terminal(item.state) && !stopped) timer = setTimeout(poll, 2000)
      } catch (err) {
        if (!stopped) setError(err.message || '暂时无法取得检查进度，请重新进入此页面重试')
      }
    }
    poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [id, experiment, setResults])

  async function start() {
    setBusy(true); setError('')
    try {
      if (id && job && terminal(job.state)) {
        const cleared = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
        if (!cleared.ok) throw new Error('上次任务记录暂时无法清理，请稍后重试')
      }
      const response = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: conn.host.trim(), port: conn.port.trim() || '22', user: conn.user.trim(), authType: conn.auth,
          password: conn.auth === 'password' ? conn.secret : '', privateKey: conn.auth === 'key' ? conn.secret : '',
          authorized: conn.authorized, hostKeyFingerprint: facts?.HOSTKEY || '', experiment }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '检查未能启动')
      setJobs((current) => ({ ...current, [experiment]: data.id }))
    } catch (err) { setError(err.message || '检查服务暂时不可用') }
    finally { setBusy(false) }
  }
  async function cancel() {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/jobs/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('暂时无法停止任务，请稍后重试')
      setJob((current) => ({ ...current, state: 'cancelling', message: '正在停止本次检查' }))
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const running = job && !terminal(job.state)
  const canStart = experiment !== 'E2' && facts && conn.authorized && conn.secret && !running && !busy
  return (
    <section className="card auto-run-panel">
      <div className="auto-run-heading"><div><h2>自动检查这台电脑</h2><p>{notes[experiment]}</p></div><span className="status-tag">一次运行一项 · 执行最长20分钟</span></div>
      {!facts && <p className="project-footnote">请先在首页连接电脑，或直接分析已有记录。</p>}
      {facts && !conn.secret && <p className="project-footnote">请在连接页面重新填写本次使用的登录信息。</p>}
      <div className="auto-run-actions"><button className="primary-button" disabled={!canStart} onClick={start}>{busy ? '正在提交…' : job && terminal(job.state) ? '重新检查' : '开始自动检查'}</button>{running && <button disabled={busy || job.state === 'cancelling'} onClick={cancel} className="secondary-button">停止本次检查</button>}{results[experiment] && <button onClick={onShowResults} className="text-link">查看分析结果 →</button>}</div>
      {error && <p role="alert" className="form-error">{error}</p>}
      {job && <div className="job-progress"><strong role="status">{job.message}</strong><ol>{labels.map((label, i) => <li key={label} className={stages.indexOf(job.state) >= i ? 'done' : ''}><span>{i + 1}</span>{label}</li>)}</ol>{job.state === 'failed' && <p className="form-error">本次未产生有效结果，请查看运行记录；已有的上次结果会保留。</p>}{job.state === 'completed' && id && results[experiment] && results[experiment].jobId === id && <div><p className="project-footnote">{results[experiment].metadata?.note}</p><button onClick={onShowResults} className="primary-button">查看本次分析 →</button></div>}<details><summary>查看运行记录</summary><pre>{job.log || '正在等待运行记录…'}</pre></details></div>}
    </section>
  )
}
