import { useEffect, useRef, useState } from 'react'
import Simple from './views/Simple.jsx'
import Pro from './views/Pro.jsx'
import { validateThermalRecord, buildThermalCharts } from './lib/thermal.js'
import { validateChannelResult } from './lib/channel.js'
import { HOST_HISTORY_KEY, readHosts, rememberHost, removeHost } from './lib/hostHistory.js'

const requestedJob = new URLSearchParams(window.location.search).get('job')
const linkedJob = /^[a-f0-9]{48}$/.test(requestedJob || '') ? requestedJob : null

const initConn = { host: '', port: '22', user: '', auth: 'password', secret: '', authorized: false }

export default function App() {
  const [hostHistory, setHostHistory] = useState(() => {
    try { return readHosts(localStorage) } catch { return [] }
  })
  useEffect(() => {
    try { localStorage.setItem(HOST_HISTORY_KEY, JSON.stringify(hostHistory)) } catch {}
  }, [hostHistory])

  const onRememberHost = (host) => setHostHistory((cur) => rememberHost(cur, host))
  const onRemoveHost = (host) => {
    setHostHistory((cur) => removeHost(cur, host))

  }

  const activeProbe = useRef(null)
  const [homeVersion, setHomeVersion] = useState(0)
  const [workspaceOpen, setWorkspaceOpen] = useState(Boolean(linkedJob))
  const [confirmedTarget, setConfirmedTarget] = useState('')
  const [mode, setMode] = useState('simple')
  const [selectedProject, setSelectedProject] = useState('E1')
  const [conn, setConn] = useState(initConn)
  const [facts, setFacts] = useState(null)
  const [probing, setProbing] = useState(false)
  const [err, setErr] = useState('')
  const [health, setHealth] = useState(null)
  const [jobSubmitting, setJobSubmitting] = useState(false)
  const [autoRun, setAutoRun] = useState({ state: 'idle', message: '' })
  const autoSubmitting = useRef(false)
  const [jobs, setJobs] = useState(() => {
    if (linkedJob) return { E1: { id: linkedJob, state: 'connecting' } }
    try { const saved = JSON.parse(sessionStorage.getItem('thermalscope-jobs') || '{}'); return /^[a-f0-9]{48}$/.test(saved?.E1?.id) ? { E1: saved.E1 } : {} } catch { return {} }
  })
  useEffect(() => {
    try { sessionStorage.setItem('thermalscope-jobs', JSON.stringify(jobs)) } catch {}
  }, [jobs])

  const [results, setResults] = useState({ E1: null, E2: null, E3: null })

  useEffect(() => {
    let disposed = false
    async function fetchHealth() {
      try {
        const response = await fetch('/api/health')
        if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return
        const data = await response.json()
        if (!disposed) setHealth(data)
      } catch {}
    }
    fetchHealth()
    return () => { disposed = true }
  }, [])

  function changeMode(value) {
    if (value === mode) return
    activeProbe.current?.abort()
    activeProbe.current = null
    setProbing(false)
    if (value === 'simple') setConn((current) => ({ ...current, authorized: false }))
    setMode(value)
  }

  function goHome() {
    window.history.replaceState(null, '', window.location.pathname)
    activeProbe.current?.abort()
    activeProbe.current = null
    setProbing(false)
    setFacts(null)
    setErr('')
    if (mode !== 'simple') setConn((current) => ({ ...current, authorized: false }))
    setMode('simple')
    setWorkspaceOpen(false)
    setHomeVersion((v) => v + 1)
    window.scrollTo({ top: 0 })
  }

  async function probe(e) {
    e?.preventDefault?.()
    if (probing || autoSubmitting.current || jobSubmitting) return
    setErr('')
    setFacts(null)
    if (!conn.host.trim()) return setErr('请填写电脑地址')
    if (!conn.user.trim()) return setErr('请填写登录账号')
    if (!/^\d+$/.test(conn.port.trim() || '22') || Number(conn.port || 22) < 1 || Number(conn.port || 22) > 65535) {
      return setErr('端口需要是 1–65535 之间的数字')
    }
    if (conn.auth === 'password' && !conn.secret.trim()) return setErr('请填写密码')
    if (conn.auth === 'key' && !conn.secret.trim()) return setErr('请填写私钥')
    if (!conn.authorized) return setErr(mode === 'simple' ? '请确认你有权使用这台电脑，并允许连接后自动开始实验' : '请确认你有权连接并检查这台电脑')
    onRememberHost(conn.host)
    setProbing(true)
    const controller = new AbortController()
    activeProbe.current = controller
    const timer = setTimeout(() => controller.abort(), 45000)
    try {
      const response = await fetch('/api/probe', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: conn.host.trim(),
          port: conn.port.trim() || '22',
          user: conn.user.trim(),
          authType: conn.auth,
          password: conn.auth === 'password' ? conn.secret : '',
          privateKey: conn.auth === 'key' ? conn.secret : '',
        }),
      })
      if (activeProbe.current !== controller || targetRef.current !== targetKey) return
      if (!response.headers.get('content-type')?.includes('application/json')) {
        setErr('探测服务暂时不可用，请稍后重试。')
        return
      }
      const data = await response.json()
      if (activeProbe.current !== controller || targetRef.current !== targetKey) return
      if (data.error) setErr(data.error)
      else if (!response.ok || !data.facts?.KERNEL || !data.facts?.ARCH) setErr('未收到完整探测结果，请检查连接后重试。')
      else if (targetRef.current === targetKey) {
        setFacts(data.facts); setConfirmedTarget(targetKey); setSelectedProject('E1'); setWorkspaceOpen(true)
        if (mode === 'simple') await startAutomaticChannel(data.facts)
      }
    } catch (e2) {
      if (activeProbe.current !== controller || targetRef.current !== targetKey) return
      setErr(e2.name === 'AbortError' ? '等待响应超时，请检查目标机器是否在线。' : '无法联系探测服务，请确认网络正常。')
    } finally {
      clearTimeout(timer)
      if (activeProbe.current === controller) {
        activeProbe.current = null
        setProbing(false)
      }
    }
  }

  async function startAutomaticChannel(checkedFacts) {
    // Run only from a successful explicit connection, never from mounting a page.
    if (autoSubmitting.current) return
    const active = jobsRef.current.E1
    if (active && !['completed', 'failed', 'cancelled', 'interrupted'].includes(active.state)) {
      setAutoRun({ state: 'blocked', message: '已有任务正在进行，请先查看或停止它；没有重复启动。' })
      return
    }
    if (!checkedFacts.KERNEL?.startsWith('Linux') || checkedFacts.ARCH !== 'x86_64' || checkedFacts.VENDOR !== 'GenuineIntel' || checkedFacts.PYTHON3 !== 'present' || checkedFacts.TEMPERATURE !== 'present') {
      setAutoRun({ state: 'blocked', message: '这台电脑暂不满足收发条件，需要 Intel Linux、Python 3 和可读取的温度来源。' })
      return
    }
    autoSubmitting.current = true
    setJobSubmitting(true)
    setAutoRun({ state: 'submitting', message: '已连接，正在自动准备测试内容并启动收发…' })
    const host = conn.host.trim()
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(8))
      const bits = Array.from(bytes, (value) => String(value & 1)).join('')
      const response = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host, port: conn.port.trim() || '22', user: conn.user.trim(), authType: conn.auth,
          password: conn.auth === 'password' ? conn.secret : '', privateKey: conn.auth === 'key' ? conn.secret : '',
          hostKeyFingerprint: checkedFacts.HOSTKEY, experiment: 'channel', bits,
          authorized: conn.authorized, dedicatedHostConfirmed: conn.authorized }),
      })
      const created = await response.json()
      if (!response.ok || !/^[a-f0-9]{48}$/.test(created.id)) throw new Error(created.error || '自动启动未完成，请重新连接后重试')
      // Once accepted, keep tracking even if the user has switched pages or modes.
      setJobs((current) => ({ ...current, E1: { id: created.id, host, experiment: 'channel', state: 'connecting' } }))
      setAutoRun({ state: 'started', message: '测试内容已自动生成，正在发送与接收。无需输入序列。' })
    } catch (error) {
      setAutoRun({ state: 'failed', message: error.message || '自动启动未完成，请重新连接后重试' })
    } finally {
      autoSubmitting.current = false
      setJobSubmitting(false)
    }
  }

  const targetKey = JSON.stringify([conn.host.trim(), conn.port.trim() || '22', conn.user.trim(), conn.auth])
  const targetRef = useRef(targetKey)
  targetRef.current = targetKey
  const jobsRef = useRef(jobs)
  jobsRef.current = jobs
  const activeId = jobs.E1?.id
  const activeJobRef = useRef(activeId)
  activeJobRef.current = activeId
  useEffect(() => {
    if (!activeId || !/^[a-f0-9]{48}$/.test(activeId)) return
    let disposed = false, timer
    const controller = new AbortController()
    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${activeId}`, { signal: controller.signal })
        const data = await response.json()
        if (disposed) return
        if (!response.ok) throw new Error(data.error || '任务记录暂时不可用')
        setJobs((current) => current.E1?.id === activeId ? { ...current, E1: data } : current)
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(data.state)) setAutoRun((current) => current.state === 'started' ? { state: 'idle', message: '' } : current)
        if (data.state === 'completed') {
          if (data.experiment === 'channel') {
            const file = await fetch(`/api/jobs/${activeId}/files/channel-result.json`, { signal: controller.signal })
            if (!file.ok) throw new Error('实验结果未能取回，请刷新后重试')
            const record = await file.json()
            if (disposed || activeJobRef.current !== activeId) return
            const checked = validateChannelResult(record)
            if (checked.error) throw new Error(checked.error)
            setResults((current) => ({ ...current, E1: { ...current.E1, channel: record, channelFile: null, channelJobId: activeId, timestamp: new Date().toISOString() } }))
          } else {
            const file = await fetch(`/api/jobs/${activeId}/files/thermal-trace.json`, { signal: controller.signal })
            if (!file.ok) throw new Error('采集记录未能取回，请刷新后重试')
            const record = await file.json()
            if (disposed || activeJobRef.current !== activeId) return
            const checked = validateThermalRecord(record)
            if (checked.error) throw new Error(checked.error)
            setResults((current) => ({ ...current, E1: { ...current.E1, thermal: record, thermalJobId: activeId, charts: buildThermalCharts(record), timestamp: new Date().toISOString() } }))
          }
        }
        if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(data.state)) timer = setTimeout(poll, 1500)
      } catch (error) {
        if (!disposed) { setJobs((current) => current.E1?.id === activeId ? { ...current, E1: { ...current.E1, connectionError: error.message } } : current); timer = setTimeout(poll, 3000) }
      }
    }
    poll()
    return () => { disposed = true; clearTimeout(timer); controller.abort() }
  }, [activeId])

  const shared = {
    workspaceOpen, setWorkspaceOpen, confirmedTarget, targetKey, jobSubmitting, setJobSubmitting, autoRun,
    goHome, hostHistory, onRememberHost, onRemoveHost,
    jobs, setJobs, selectedProject, setSelectedProject,
    results, setResults, conn, setConn, facts: confirmedTarget === targetKey ? facts : null, probing, err, probe, health,
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <button type="button" className="brand" onClick={goHome} aria-label="ThermalScope 热信号收发实验，返回首页">
            <span>ThermalScope</span>
            <span className="brand-divider" />
            <span className="brand-product">热信号收发实验</span>
          </button>
          <nav className="mode-switch" aria-label="页面模式">
            {[['simple', '简洁版'], ['pro', '专业版']].map(([value, label]) => (
              <button key={value} onClick={() => changeMode(value)} className={mode === value ? 'active' : ''}>
                {label}
              </button>
            ))}
          </nav>
          <span className="header-caption">热信号收发实验</span>
        </div>
      </header>
      <main className="flex-1">
        {mode === 'simple' ? <Simple key={homeVersion} {...shared} /> : <Pro {...shared} />}
      </main>
      <footer className="app-footer">
        <span>ThermalScope · 热信号收发实验</span>
        <span>仅检查你有权使用的电脑 · 登录信息不保存</span>
      </footer>
    </div>
  )
}
